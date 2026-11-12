let authToken = localStorage.getItem('asky_staff_token') || '';
let currentUser = JSON.parse(localStorage.getItem('asky_staff_user') || 'null');
let currentDeclarations = [];
let autoActionTriggered = false;

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
      const username = document.getElementById('username').value.trim();
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
        console.error('Erreur login:', err);
        alert('Erreur de connexion au serveur.');
      }
    });
  }

  // Support douchette QR USB dans le champ de recherche
  const searchInput = document.getElementById('filterSearch');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        let val = searchInput.value.trim();
        // Si la douchette colle l'URL complète du QR Code, on extrait uniquement la référence ASKY-FIH-...
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

  const userInfo = document.getElementById('userInfo');
  if (userInfo && currentUser) {
    userInfo.innerHTML = `
      <span>Agent : <strong>${currentUser.full_name || currentUser.username}</strong> (${currentUser.role})</span>
      <button onclick="logout()" class="btn-secondary" style="margin-left:12px;">Déconnexion</button>
    `;
  }

  // Pré-remplir la recherche si arrivée via scan QR Code
  const pendingRef = sessionStorage.getItem('asky_pending_scan_ref');
  const searchInput = document.getElementById('filterSearch');
  if (pendingRef && searchInput) {
    searchInput.value = pendingRef;
  }
  if (searchInput) {
    searchInput.focus();
  }

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
  const flight = document.getElementById('filterFlight').value.trim();
  const date = document.getElementById('filterDate').value;
  const search = document.getElementById('filterSearch').value.trim();

  const params = new URLSearchParams();
  if (flight) params.append('flight', flight);
  if (date) params.append('date', date);
  if (search) params.append('search', search);

  try {
    const res = await fetch(`/api/staff/declarations?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (res.status === 401 || res.status === 403) {
      logout();
      return;
    }

    const declarations = await res.json();
    const list = Array.isArray(declarations) ? declarations : [];
    renderTable(list);

    // Déclenchement automatique de l'action de validation si ouvert par scan QR
    const pendingRef = sessionStorage.getItem('asky_pending_scan_ref');
    const shouldTriggerAction = sessionStorage.getItem('asky_pending_scan_action') === '1';

    if (pendingRef && shouldTriggerAction && !autoActionTriggered && list.length === 1) {
      const target = list[0];
      autoActionTriggered = true;
      sessionStorage.removeItem('asky_pending_scan_ref');
      sessionStorage.removeItem('asky_pending_scan_action');
      // Nettoyer l'URL sans recharger la page
      window.history.replaceState({}, document.title, '/staff.html');

      if (target.status !== 'VERIFIED_OK') {
        setTimeout(() => verifyDeclaration(target.id), 250);
      } else {
        alert(`Dossier ${target.declaration_ref} (${target.passenger_name}) déjà vérifié OK.`);
      }
    }
  } catch (err) {
    console.error('Erreur chargement déclarations:', err);
    document.getElementById('declarationsTable').innerHTML =
      '<tr><td colspan="8" style="text-align:center;color:red;">Erreur de chargement des données.</td></tr>';
  }
}

function renderTable(rows) {
  currentDeclarations = rows || [];
  const tbody = document.getElementById('declarationsTable');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Aucune déclaration trouvée.</td></tr>';
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
        <td>${d.booking_ref}</td>
        <td>${d.flight_number} <br><small>${fDate}</small></td>
        <td>${d.origin || 'FIH'} → ${d.destination}</td>
        <td>${q5Alert}</td>
        <td><span class="badge">${d.status}</span></td>
        <td>
          ${d.status !== 'VERIFIED_OK'
            ? `<button onclick="verifyDeclaration(${d.id})" class="btn-primary" style="padding:4px 8px;font-size:12px;">Valider OK</button>`
            : '<span style="color:#15803d;font-weight:bold;">✔ Vérifié</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

async function verifyDeclaration(id) {
  const notes = prompt('Notes d’inspection agent (optionnel) :', 'Contrôle visuel conforme SKK-GRH-REC-015');
  if (notes === null) return;

  try {
    const res = await fetch(`/api/staff/declarations/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        status: 'VERIFIED_OK',
        agent_notes: notes
      })
    });

    if (!res.ok) {
      alert('Impossible de mettre à jour le statut.');
      return;
    }

    // Réinitialiser le filtre après validation pour réafficher tous les passagers du vol
    document.getElementById('filterSearch').value = '';
    loadDeclarations();
  } catch (err) {
    console.error('Erreur validation:', err);
    alert('Erreur réseau lors de la validation.');
  }
}

function exportToCSV() {
  if (!currentDeclarations || currentDeclarations.length === 0) {
    alert('Aucune déclaration à exporter pour les filtres sélectionnés.');
    return;
  }

  const headers = [
    'Reference', 'Passager', 'PNR', 'Vol', 'Date_Vol',
    'Origine', 'Destination', 'Alerte_Q5_Endommagee', 'Statut', 'Notes_Agent'
  ];

  const csvRows = [headers.join(';')];

  currentDeclarations.forEach(d => {
    const fDate = d.flight_date ? String(d.flight_date).split('T')[0] : '';
    const row = [
      d.declaration_ref,
      `"${(d.passenger_name || '').replace(/"/g, '""')}"`,
      d.booking_ref,
      d.flight_number,
      fDate,
      d.origin || 'FIH',
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
  const flightTag = document.getElementById('filterFlight').value.trim() || 'TOUS_VOLS';
  const dateTag = document.getElementById('filterDate').value || new Date().toISOString().split('T')[0];

  link.href = url;
  link.download = `ASKY_DG_FIH_${flightTag}_${dateTag}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}