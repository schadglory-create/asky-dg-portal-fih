function switchLang(lang) {
  document.getElementById('btn-fr').classList.toggle('active', lang === 'fr');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');

  document.querySelectorAll('[data-fr]').forEach(el => {
    el.textContent = el.getAttribute(`data-${lang}`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // 1. Pré-remplissage automatique de l'escale si scannée depuis l'affiche QR (?station=BZV)
  const urlParams = new URLSearchParams(window.location.search);
  const stationParam = urlParams.get('station');
  const originSelect = document.getElementById('origin');
  const stationBanner = document.getElementById('stationBanner');

  if (stationParam && originSelect) {
    const code = stationParam.trim().toUpperCase();
    const matchingOption = Array.from(originSelect.options).find(opt => opt.value === code);
    if (matchingOption) {
      originSelect.value = code;
      if (stationBanner) {
        stationBanner.textContent = `Escale ${matchingOption.textContent}`;
      }
    }
  }

  // Mettre à jour le bandeau si le passager change manuellement l'escale
  if (originSelect && stationBanner) {
    originSelect.addEventListener('change', () => {
      const selected = originSelect.options[originSelect.selectedIndex];
      stationBanner.textContent = selected && selected.value
        ? `Escale ${selected.textContent}`
        : 'Réseau ASKY (KP)';
    });
  }

  // 2. Date du jour par défaut pour fluidifier la saisie au comptoir
  const flightDateInput = document.getElementById('flight_date');
  if (flightDateInput && !flightDateInput.value) {
    flightDateInput.value = new Date().toISOString().split('T')[0];
  }

  // 3. Formatage intelligent du N° de vol (préfixe KP automatique si le passager tape juste 031)
  const flightInput = document.getElementById('flight_number');
  if (flightInput) {
    flightInput.addEventListener('blur', () => {
      let val = flightInput.value.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
      if (/^\d+$/.test(val)) {
        val = 'KP' + val;
      }
      flightInput.value = val;
    });
  }

  const form = document.getElementById('passengerForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const getRadioBool = (name) => {
      const selected = document.querySelector(`input[name="${name}"]:checked`);
      return selected ? selected.value === 'true' : false;
    };

    const payload = {
      passenger_name: document.getElementById('passenger_name').value.trim(),
      flight_number: document.getElementById('flight_number').value.trim(),
      flight_date: document.getElementById('flight_date').value,
      origin: document.getElementById('origin').value,
      destination: document.getElementById('destination').value,
      q1_spare_lithium_powerbanks: getRadioBool('q1'),
      q2_carried_on_person_cabin: getRadioBool('q2'),
      q3_max_two_powerbanks: getRadioBool('q3'),
      q4_short_circuit_protection: getRadioBool('q4'),
      q5_damaged_defective_swollen: getRadioBool('q5'),
      q6_no_checked_baggage: getRadioBool('q6'),
      q7_no_recharging_onboard: getRadioBool('q7'),
      q8_no_charging_other_devices: getRadioBool('q8'),
      passenger_signature_ack: document.getElementById('passenger_signature_ack').checked
    };

    try {
      const res = await fetch('/api/declarations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Erreur lors de la soumission.');
        return;
      }

      const ref = data.declaration.declaration_ref;
      document.getElementById('displayRef').textContent = ref;

      const scanUrl = `${window.location.origin}/staff.html?ref=${encodeURIComponent(ref)}&scan=1`;
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(scanUrl)}`;

      const qrImg = document.getElementById('passengerQrImg');
      if (qrImg) qrImg.src = qrApiUrl;

      const dlBtn = document.getElementById('downloadQrBtn');
      if (dlBtn) {
        dlBtn.href = qrApiUrl;
        dlBtn.download = `${ref}_QR.png`;
      }

      document.getElementById('confirmationModal').classList.remove('hidden');
    } catch (err) {
      console.error('Erreur soumission:', err);
      alert('Erreur de connexion au serveur.');
    }
  });
});
