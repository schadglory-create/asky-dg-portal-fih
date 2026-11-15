let authToken = localStorage.getItem('asky_staff_token') || '';
let currentUser = JSON.parse(localStorage.getItem('asky_staff_user') || 'null');
let currentDeclarations = [];
let autoActionTriggered = false;
let activeVerifyId = null;
let resumeScanAfterSetup = false;

const SCANNER_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 heures d'inactivité max

function getScannerConfig() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const saved = JSON.parse(localStorage.getItem('asky_scanner_config') || 'null');
    if (!saved || saved.date !== today || !saved.mode) return null;

    if (saved.lastUsedAt && (Date.now() - saved.lastUsedAt > SCANNER_IDLE_TIMEOUT_MS)) {
      localStorage.removeItem('asky_scanner_config');
      return null;
    }
    return saved;
  } catch (_) {}
  return null;
}

function touchScannerActivity() {
  const cfg = getScannerConfig();
  if (cfg) {
    cfg.lastUsedAt = Date.now();
    localStorage.setItem('asky_scanner_config', JSON.stringify(cfg));
  }
}

function updateScannerBanner() {
  const cfg = getScannerConfig();
  const statusEl = document.getElementById('activeFlightStatus');
  if (!statusEl) return;

  if (cfg && cfg.mode === 'FLIGHT') {
    statusEl.innerHTML = `<span style="background:#15803d; color:#fff; padding:3px 8px; border-radius:4px; font-weight:bold;">Escale ${cfg.origin} — Vol ${cfg.flight}</span> <small>(Expire après 2h d'inactivité)</small>`;
  } else if (cfg && cfg.mode === 'MULTI_FLIGHT') {
    statusEl.innerHTML = `<span style="background:#2563eb; color:#fff; padding:3px 8px; border-radius:4px; font-weight:bold;">Mode Multi-Vols (${cfg.origin || 'Réseau'})</span> <small>(Saisie passager conservée)</small>`;
  } else {
    statusEl.textContent = 'Prêt — Le numéro de vol sera demandé au prochain scan QR';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const scannedRef = urlParams.get('ref');
  const isScan = urlParams.get('scan') === '1';

  if (scannedRef) {
    sessionStorage.setItem('asky_pending_scan_ref', scannedRef.trim().toUpperCase());
    sessionStorage.setItem('asky_pending_scan_action', isScan ? '1' : '0');
  }

  if (authToken && currentUser) {
    showDashboard();
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim().toUpperCase();
      const password = document.getElementById('password').value;

      try {
        const res = await fetch('/api/staff/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Identifiants incorrects.');
          return;
        }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('asky_staff_token', authToken);
        localStorage.setItem('asky_staff_user', JSON.stringify(currentUser));

        showDashboard();
      } catch (err) {
        alert('Erreur de connexion au serveur.');
      }
    });
  }

  const searchInput = document.getElementById('filterSearch');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        let val = searchInput.value.trim();
        if (val.includes('ref=')) {
          try {
            const parsed = new URL(val);
            const extractedRef = parsed.searchParams.get('ref');
            if (extractedRef) {
              val = extractedRef.toUpperCase();
              searchInput.value = val;
            }
          } catch (_) {}
        }
        sessionStorage.setItem('asky_pending_scan_ref', val.toUpperCase());
        sessionStorage.setItem('asky_pending_scan_action', '1');
        autoActionTriggered = false;
        loadDeclarations();
      }
    });
  }
});

function showDashboard() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');

  const headerTitle = document.getElementById('staffHeaderTitle');
  if (headerTitle && currentUser) {
    headerTitle.textContent = currentUser.role === 'SUPER_ADMIN'
      ? 'ASKY Dangerous Goods Portal — Supervision Réseau (HQ)'
      : `ASKY Dangerous Goods Portal — Escale ${currentUser.station_code}`;
  }

  const userInfo = document.getElementById('userInfo');
  if (userInfo && currentUser) {
    userInfo.innerHTML = `
      <span>Station : <strong>${currentUser.username}</strong></span>
      <button onclick="openModal('changePwdModal')" class="btn-secondary" style="margin-left:10px; font-size:12px;">Mot de passe</button>
      <button onclick="logout()" class="btn-secondary" style="margin-left:6px; font-size:12px;">Déconnexion</button>
    `;
  }

  updateScannerBanner();

  const stationSelect = document.getElementById('filterStation');
  if (stationSelect && currentUser) {
    stationSelect.value = currentUser.station_code && currentUser.station_code !== 'ALL'
      ? currentUser.station_code
      : 'ALL';
  }

  if (currentUser && currentUser.role === 'SUPER_ADMIN') {
    loadAdminStations();
  }

  const pendingRef = sessionStorage.getItem('asky_pending_scan_ref');
  const searchInput = document.getElementById('filterSearch');
  if (pendingRef && searchInput) {
    searchInput.value = pendingRef;
    if (stationSelect) stationSelect.value = 'ALL';
  }
  if (searchInput) searchInput.focus();

  loadDeclarations();
}

function logout() {
  localStorage.removeItem('asky_staff_token');
  localStorage.removeItem('asky_staff_user');
  authToken = '';
  currentUser = null;
  location.reload();
}

async function loadDeclarations() {
  const station = document.getElementById('filterStation').value;
  const flight = document.getElementById('filterFlight').value.trim();
  const date = document.getElementById('filterDate').value;
  const search = document.getElementById('filterSearch').value.trim();

  const params = new URLSearchParams();
  if (station) params.append('station', station);
  if (flight) params.append('flight', flight);
  if (date) params.append('date', date);
  if (search) params.append('search', search);

  try {
    const res = await fetch(`/api/staff/declarations?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      logout();
      return;
    }

    const declarations = await res.json();
    const list = Array.isArray(declarations) ? declarations : [];
    renderTable(list);

    const pendingRef = sessionStorage.getItem('asky_pending_scan_ref');
    const shouldTriggerAction = sessionStorage.getItem('asky_pending_scan_action') === '1';

    if (pendingRef && shouldTriggerAction && !autoActionTriggered && list.length === 1) {
      const target = list[0];
      const scannerCfg = getScannerConfig();

      if (!scannerCfg) {
        openScannerSetupModal(true);
        return;
      }

      autoActionTriggered = true;
      sessionStorage.removeItem('asky_pending_scan_ref');
      sessionStorage.removeItem('asky_pending_scan_action');
      window.history.replaceState({}, document.title, '/staff.html');

      await processScannedDeclaration(target, scannerCfg);
    }
  } catch (err) {
    document.getElementById('declarationsTable').innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:red;">Erreur de chargement des données.</td></tr>';
  }
}

async function processScannedDeclaration(target, scannerCfg) {
  touchScannerActivity();
  let wasAutoFixed = false;
  let fixDetails = [];

  if (scannerCfg.mode === 'FLIGHT') {
    const needsFlightFix = scannerCfg.flight && target.flight_number !== scannerCfg.flight;
    const needsOriginFix = scannerCfg.origin && target.origin !== scannerCfg.origin;

    if (needsFlightFix || needsOriginFix) {
      try {
        const patchRes = await fetch(`/api/staff/declarations/${target.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            flight_number: scannerCfg.flight,
            origin: scannerCfg.origin
          })
        });

        if (patchRes.ok) {
          const updated = await patchRes.json();
          if (needsFlightFix) fixDetails.push(`Vol corrigé : ${target.flight_number} → ${updated.flight_number}`);
          if (needsOriginFix) fixDetails.push(`Escale corrigée : ${target.origin} → ${updated.origin}`);
          target.flight_number = updated.flight_number;
          target.origin = updated.origin;
          wasAutoFixed = true;
          const idx = currentDeclarations.findIndex(d => d.id === target.id);
          if (idx !== -1) currentDeclarations[idx] = target;
          renderTable(currentDeclarations);
        }
      } catch (_) {}
    }
  }

  openVerifyModal(target.id, wasAutoFixed ? fixDetails.join(' | ') : '');
}

function openScannerSetupModal(fromScan = false) {
  resumeScanAfterSetup = fromScan;
  const cfg = getScannerConfig();
  const originSelect = document.getElementById('setupOriginSelect');
  const flightInput = document.getElementById('setupFlightInput');

  if (cfg) {
    originSelect.value = cfg.origin;
    flightInput.value = cfg.flight;
  } else {
    if (currentUser && currentUser.station_code && currentUser.station_code !== 'ALL') {
      originSelect.value = currentUser.station_code;
    }
    flightInput.value = '';
  }
  openModal('scannerSetupModal');
  setTimeout(() => flightInput.focus(), 100);
}

function saveScannerConfig() {
  const origin = document.getElementById('setupOriginSelect').value.trim().toUpperCase();
  let flight = document.getElementById('setupFlightInput').value.trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d+$/.test(flight)) flight = 'KP' + flight;

  const today = new Date().toISOString().split('T')[0];
  const mode = flight ? 'FLIGHT' : 'MULTI_FLIGHT';

  localStorage.setItem('asky_scanner_config', JSON.stringify({
    mode,
    origin,
    flight,
    date: today,
    lastUsedAt: Date.now()
  }));

  updateScannerBanner();
  closeModal('scannerSetupModal');

  if (resumeScanAfterSetup) {
    resumeScanAfterSetup = false;
    loadDeclarations();
  }
}

function ignoreScannerConfig() {
  const origin = document.getElementById('setupOriginSelect').value.trim().toUpperCase();
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem('asky_scanner_config', JSON.stringify({
    mode: 'MULTI_FLIGHT',
    origin,
    flight: '',
    date: today,
    lastUsedAt: Date.now()
  }));

  updateScannerBanner();
  closeModal('scannerSetupModal');

  if (resumeScanAfterSetup) {
    resumeScanAfterSetup = false;
    loadDeclarations();
  }
}

function resetScannerFlight() {
  localStorage.removeItem('asky_scanner_config');
  updateScannerBanner();
  alert('Configuration du vol réinitialisée. Le nouveau numéro de vol sera demandé au prochain scan.');
}

function renderTable(rows) {
  currentDeclarations = rows || [];
  const tbody = document.getElementById('declarationsTable');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Aucune déclaration trouvée.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(d => {
    const fDate = d.flight_date ? String(d.flight_date).split('T')[0] : '-';
    const q5Alert = d.q5_damaged_defective_swollen
      ? '<span style="color:#b91c1c;font-weight:bold;">OUI (INSPECTION)</span>'
      : '<span style="color:#15803d;">NON (OK)</span>';

    const highlightStyle = rows.length === 1 ? 'background-color:#fef9c3;' : '';

    return `
      <tr style="${highlightStyle}">
        <td><strong>${d.declaration_ref}</strong></td>
        <td>${d.passenger_name}</td>
        <td><strong>${d.flight_number}</strong><br><small>${fDate}</small></td>
        <td>${d.origin} → ${d.destination}</td>
        <td>${q5Alert}</td>
        <td><span class="badge">${d.status}</span></td>
        <td>
          ${d.status !== 'VERIFIED_OK'
            ? `<button onclick="openVerifyModal(${d.id})" class="btn-primary" style="padding:5px 10px;font-size:12px;">Contrôler / Valider</button>`
            : `<span style="color:#15803d;font-weight:bold;">✔ Vérifié</span> <button onclick="openVerifyModal(${d.id})" class="btn-secondary" style="padding:2px 6px;font-size:11px;margin-left:4px;">Modifier</button>`}
        </td>
      </tr>
    `;
  }).join('');
}

function openVerifyModal(id, autoFixMessage = '') {
  const item = currentDeclarations.find(d => d.id === id);
  if (!item) return;
  activeVerifyId = id;

  const cfg = getScannerConfig();
  const isDedicatedFlight = cfg && cfg.mode === 'FLIGHT';

  document.getElementById('verifyPassengerInfo').textContent = `${item.passenger_name} (${item.declaration_ref})`;
  document.getElementById('verifyOriginInput').value = isDedicatedFlight ? cfg.origin : (item.origin || '');
  document.getElementById('verifyFlightInput').value = isDedicatedFlight ? cfg.flight : (item.flight_number || '');
  document.getElementById('verifyNotesInput').value = item.agent_notes || 'Contrôle visuel conforme SKK-GRH-REC-015';

  const noticeEl = document.getElementById('autoFixNotice');
  if (noticeEl) {
    if (autoFixMessage) {
      noticeEl.textContent = `✔ Auto-correction appliquée : ${autoFixMessage}`;
      noticeEl.classList.remove('hidden');
    } else {
      noticeEl.classList.add('hidden');
    }
  }

  openModal('verifyModal');
}

async function confirmVerifyDeclaration() {
  if (!activeVerifyId) return;
  const correctedOrigin = document.getElementById('verifyOriginInput').value.trim().toUpperCase();
  const correctedFlight = document.getElementById('verifyFlightInput').value.trim().toUpperCase();
  const notes = document.getElementById('verifyNotesInput').value.trim();

  try {
    const res = await fetch(`/api/staff/declarations/${activeVerifyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        status: 'VERIFIED_OK',
        origin: correctedOrigin,
        flight_number: correctedFlight,
        agent_notes: notes
      })
    });

    if (!res.ok) {
      alert('Impossible de mettre à jour la déclaration.');
      return;
    }

    closeModal('verifyModal');
    document.getElementById('filterSearch').value = '';
    if (currentUser && currentUser.station_code && currentUser.station_code !== 'ALL') {
      document.getElementById('filterStation').value = currentUser.station_code;
    }
    loadDeclarations();
  } catch (err) {
    alert('Erreur réseau lors de la validation.');
  }
}

function openBulkFlightModal() {
  const currentFilterDate = document.getElementById('filterDate').value || new Date().toISOString().split('T')[0];
  document.getElementById('bulkDate').value = currentFilterDate;
  document.getElementById('bulkWrongFlight').value = '';
  document.getElementById('bulkCorrectFlight').value = '';
  openModal('bulkFlightModal');
}

async function submitBulkFlightFix() {
  const flightDate = document.getElementById('bulkDate').value;
  const wrongFlight = document.getElementById('bulkWrongFlight').value.trim();
  const correctFlight = document.getElementById('bulkCorrectFlight').value.trim();
  const station = document.getElementById('filterStation').value;

  if (!flightDate || !wrongFlight || !correctFlight) {
    alert('Veuillez remplir tous les champs.');
    return;
  }

  try {
    const res = await fetch('/api/staff/bulk-fix-flight', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ station, flightDate, wrongFlight, correctFlight })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erreur lors de la correction.');
      return;
    }
    alert(data.message);
    closeModal('bulkFlightModal');
    loadDeclarations();
  } catch (err) {
    alert('Erreur réseau.');
  }
}

async function submitChangePassword() {
  const currentPassword = document.getElementById('oldPwdInput').value;
  const newPassword = document.getElementById('newPwdInput').value;

  try {
    const res = await fetch('/api/staff/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erreur.');
      return;
    }
    alert(data.message);
    closeModal('changePwdModal');
  } catch (err) {
    alert('Erreur réseau.');
  }
}

function openEmergencyResetModal(e) {
  if (e) e.preventDefault();
  document.getElementById('resetStationInput').value = document.getElementById('username').value.trim().toUpperCase();
  document.getElementById('resetMasterKeyInput').value = '';
  openModal('emergencyResetModal');
}

async function submitEmergencyReset() {
  const username = document.getElementById('resetStationInput').value.trim();
  const masterKey = document.getElementById('resetMasterKeyInput').value.trim();

  try {
    const res = await fetch('/api/staff/emergency-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, masterKey })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erreur.');
      return;
    }
    alert(data.message);
    closeModal('emergencyResetModal');
  } catch (err) {
    alert('Erreur réseau.');
  }
}

async function loadAdminStations() {
  try {
    const res = await fetch('/api/staff/stations', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const stations = await res.json();
    const panel = document.getElementById('superAdminPanel');
    const container = document.getElementById('stationsAdminList');
    panel.classList.remove('hidden');

    container.innerHTML = stations
      .filter(s => s.username !== 'ADMIN')
      .map(s => `
        <button onclick="adminResetStation('${s.username}')" class="btn-secondary" style="font-size:12px; padding:6px 10px;">
          Reset <strong>${s.username}</strong>
        </button>
      `).join('');
  } catch (_) {}
}

async function adminResetStation(username) {
  if (!confirm(`Réinitialiser le mot de passe de l'escale ${username} sur Asky2026 ?`)) return;
  const res = await fetch(`/api/staff/admin-reset/${username}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  alert(data.message || 'Effectué.');
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function exportToCSV() {
  if (!currentDeclarations || currentDeclarations.length === 0) {
    alert('Aucune déclaration à exporter pour les filtres sélectionnés.');
    return;
  }

  const headers = [
    'Reference', 'Passager', 'Vol', 'Date_Vol',
    'Origine', 'Destination', 'Alerte_Q5_Endommagee', 'Statut', 'Notes_Agent'
  ];

  const csvRows = [headers.join(';')];

  currentDeclarations.forEach(d => {
    const fDate = d.flight_date ? String(d.flight_date).split('T')[0] : '';
    const row = [
      d.declaration_ref,
      `"${(d.passenger_name || '').replace(/"/g, '""')}"`,
      d.flight_number,
      fDate,
      d.origin,
      d.destination,
      d.q5_damaged_defective_swollen ? 'OUI_INSPECTION' : 'NON',
      d.status,
      `"${(d.agent_notes || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(';'));
  });

  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stationTag = document.getElementById('filterStation').value || 'RESEAU';
  const flightTag = document.getElementById('filterFlight').value.trim() || 'TOUS_VOLS';
  const dateTag = document.getElementById('filterDate').value || new Date().toISOString().split('T')[0];

  link.href = url;
  link.download = `ASKY_DG_${stationTag}_${flightTag}_${dateTag}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
