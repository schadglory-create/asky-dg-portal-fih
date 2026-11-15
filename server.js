const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ASKY_SECRET_KEY_NETWORK_2026';
const MASTER_RESET_KEY = process.env.MASTER_RESET_KEY || 'KP-MASTER-2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ASKY_STATIONS = [
  { code: 'LFW', name: 'Lomé (Siège)' },
  { code: 'FIH', name: 'Kinshasa' },
  { code: 'BZV', name: 'Brazzaville' },
  { code: 'ABJ', name: 'Abidjan' },
  { code: 'ACC', name: 'Accra' },
  { code: 'LOS', name: 'Lagos' },
  { code: 'ABV', name: 'Abuja' },
  { code: 'DLA', name: 'Douala' },
  { code: 'NSI', name: 'Yaoundé' },
  { code: 'LBV', name: 'Libreville' },
  { code: 'COO', name: 'Cotonou' },
  { code: 'BKO', name: 'Bamako' },
  { code: 'OUA', name: 'Ouagadougou' },
  { code: 'NIM', name: 'Niamey' },
  { code: 'DKR', name: 'Dakar' },
  { code: 'CKY', name: 'Conakry' },
  { code: 'FNA', name: 'Freetown' },
  { code: 'BJL', name: 'Banjul' },
  { code: 'OXB', name: 'Bissau' },
  { code: 'NDJ', name: "N'Djamena" },
  { code: 'BGF', name: 'Bangui' },
  { code: 'LAD', name: 'Luanda' },
  { code: 'PNR', name: 'Pointe-Noire' },
  { code: 'SSG', name: 'Malabo' },
  { code: 'TMS', name: 'São Tomé' },
  { code: 'ROB', name: 'Monrovia' },
  { code: 'JNB', name: 'Johannesburg' }
];

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        station_code VARCHAR(10) DEFAULT 'ALL',
        role VARCHAR(20) DEFAULT 'STATION',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS declarations (
        id SERIAL PRIMARY KEY,
        declaration_ref VARCHAR(30) UNIQUE NOT NULL,
        passenger_name VARCHAR(150) NOT NULL,
        booking_ref VARCHAR(20) DEFAULT 'N/A',
        flight_number VARCHAR(20) NOT NULL,
        flight_date DATE NOT NULL,
        origin VARCHAR(10) NOT NULL,
        destination VARCHAR(10) NOT NULL,
        q1_spare_lithium_powerbanks BOOLEAN,
        q2_carried_on_person_cabin BOOLEAN,
        q3_max_two_powerbanks BOOLEAN,
        q4_short_circuit_protection BOOLEAN,
        q5_damaged_defective_swollen BOOLEAN,
        q6_no_checked_baggage BOOLEAN,
        q7_no_recharging_onboard BOOLEAN,
        q8_no_charging_other_devices BOOLEAN,
        passenger_signature_ack BOOLEAN NOT NULL,
        status VARCHAR(30) DEFAULT 'SUBMITTED',
        agent_notes TEXT,
        verified_by INTEGER REFERENCES users(id),
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS station_code VARCHAR(10) DEFAULT 'ALL'`);
    await pool.query(`ALTER TABLE declarations ALTER COLUMN booking_ref DROP NOT NULL`);
    await pool.query(`ALTER TABLE declarations ALTER COLUMN booking_ref SET DEFAULT 'N/A'`);

    const defaultHash = await bcrypt.hash('Asky2026', 10);

    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, station_code, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET role = 'SUPER_ADMIN', station_code = 'ALL'`,
      ['ADMIN', defaultHash, 'Supervision Réseau ASKY (HQ)', 'ALL', 'SUPER_ADMIN']
    );

    for (const st of ASKY_STATIONS) {
      await pool.query(
        `INSERT INTO users (username, password_hash, full_name, station_code, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username) DO NOTHING`,
        [st.code, defaultHash, `Escale ${st.name} (${st.code})`, st.code, 'STATION']
      );
    }

    console.log('Base de données Neon ASKY Réseau initialisée avec succès.');
  } catch (err) {
    console.error('ERREUR INIT DB NEON:', err.message);
  }
}

async function cleanOldDeclarations() {
  try {
    const resDate = await pool.query(
      "DELETE FROM declarations WHERE created_at < NOW() - INTERVAL '90 days'"
    );
    const resLimit = await pool.query(`
      DELETE FROM declarations
      WHERE id NOT IN (
        SELECT id FROM declarations ORDER BY created_at DESC LIMIT 50000
      )
    `);
    const total = (resDate.rowCount || 0) + (resLimit.rowCount || 0);
    if (total > 0) {
      console.log(`Rotation DB : ${total} ancienne(s) déclaration(s) purgée(s).`);
    }
  } catch (err) {
    console.error('Erreur rotation automatique:', err.message);
  }
}

initDatabase().then(() => cleanOldDeclarations());
setInterval(cleanOldDeclarations, 24 * 60 * 60 * 1000);

function generateDeclarationRef(originCode) {
  const station = (originCode || 'KP').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'KP';
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = `ASKY-${station}-`;
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function normalizeFlightNumber(raw) {
  if (!raw) return '';
  let clean = String(raw).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(clean)) {
    clean = 'KP' + clean;
  }
  return clean;
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Accès non autorisé' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expirée, veuillez vous reconnecter.' });
    req.user = user;
    next();
  });
}

app.get('/', (req, res) => {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  if (fs.existsSync(rootIndex)) return res.sendFile(rootIndex);
  res.status(404).send('Fichier index.html introuvable.');
});

// 1. Soumission déclaration passager (sans PNR)
app.post('/api/declarations', async (req, res) => {
  try {
    const {
      passenger_name, flight_number, flight_date, origin, destination,
      q1_spare_lithium_powerbanks, q2_carried_on_person_cabin, q3_max_two_powerbanks,
      q4_short_circuit_protection, q5_damaged_defective_swollen, q6_no_checked_baggage,
      q7_no_recharging_onboard, q8_no_charging_other_devices, passenger_signature_ack
    } = req.body;

    if (!passenger_name || !flight_number || !flight_date || !origin || !destination || !passenger_signature_ack) {
      return res.status(400).json({ error: 'Veuillez remplir tous les champs obligatoires.' });
    }

    const cleanOrigin = origin.trim().toUpperCase();
    const cleanDest = destination.trim().toUpperCase();
    if (cleanOrigin === cleanDest) {
      return res.status(400).json({ error: 'La destination doit être différente de la provenance.' });
    }

    const cleanFlight = normalizeFlightNumber(flight_number);
    const initialStatus = q5_damaged_defective_swollen === true ? 'REQUIRES_INSPECTION' : 'SUBMITTED';
    const ref = generateDeclarationRef(cleanOrigin);

    const query = `
      INSERT INTO declarations (
        declaration_ref, passenger_name, booking_ref, flight_number, flight_date, origin, destination,
        q1_spare_lithium_powerbanks, q2_carried_on_person_cabin, q3_max_two_powerbanks,
        q4_short_circuit_protection, q5_damaged_defective_swollen, q6_no_checked_baggage,
        q7_no_recharging_onboard, q8_no_charging_other_devices, passenger_signature_ack, status
      ) VALUES ($1, $2, 'N/A', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING declaration_ref, status, origin, flight_number, created_at;
    `;

    const values = [
      ref, passenger_name.trim().toUpperCase(), cleanFlight,
      flight_date, cleanOrigin, cleanDest,
      q1_spare_lithium_powerbanks, q2_carried_on_person_cabin, q3_max_two_powerbanks,
      q4_short_circuit_protection, q5_damaged_defective_swollen, q6_no_checked_baggage,
      q7_no_recharging_onboard, q8_no_charging_other_devices, passenger_signature_ack, initialStatus
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, declaration: result.rows[0] });
  } catch (err) {
    console.error('Erreur insertion déclaration:', err);
    res.status(500).json({ error: 'Erreur DB: ' + err.message });
  }
});

// 2. Connexion Escale / Super-Admin
app.post('/api/staff/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const cleanUser = (username || '').trim().toUpperCase();
    const result = await pool.query('SELECT * FROM users WHERE UPPER(username) = $1', [cleanUser]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Code station ou identifiant inconnu.' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        station_code: user.station_code,
        full_name: user.full_name
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        station_code: user.station_code,
        full_name: user.full_name
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur d’authentification.' });
  }
});

// 3. Changement de mot de passe par l'escale connectée
app.post('/api/staff/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Ancien mot de passe incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    res.json({ success: true, message: 'Mot de passe mis à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors du changement de mot de passe.' });
  }
});

// 4. Réinitialisation d'urgence via Code Maître Réseau
app.post('/api/staff/emergency-reset', async (req, res) => {
  try {
    const { username, masterKey } = req.body;
    if (!username || !masterKey) {
      return res.status(400).json({ error: 'Code station et Code Maître requis.' });
    }
    if (masterKey.trim() !== MASTER_RESET_KEY) {
      return res.status(403).json({ error: 'Code Maître Réseau invalide.' });
    }

    const cleanUser = username.trim().toUpperCase();
    const defaultHash = await bcrypt.hash('Asky2026', 10);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE UPPER(username) = $2 RETURNING username',
      [defaultHash, cleanUser]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Station introuvable.' });
    }

    res.json({ success: true, message: `Le mot de passe de ${cleanUser} a été réinitialisé à Asky2026.` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la réinitialisation.' });
  }
});

// 5. Liste et réinitialisation des comptes escales (SUPER_ADMIN)
app.get('/api/staff/stations', authenticateToken, async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Réservé à la Supervision Réseau.' });
  }
  const result = await pool.query(
    'SELECT id, username, full_name, station_code, role FROM users ORDER BY username ASC'
  );
  res.json(result.rows);
});

app.post('/api/staff/admin-reset/:username', authenticateToken, async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Réservé à la Supervision Réseau.' });
  }
  const target = req.params.username.trim().toUpperCase();
  const defaultHash = await bcrypt.hash('Asky2026', 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE UPPER(username) = $2', [defaultHash, target]);
  res.json({ success: true, message: `Compte ${target} réinitialisé à Asky2026.` });
});

// 6. Consultation filtrée des déclarations
app.get('/api/staff/declarations', authenticateToken, async (req, res) => {
  try {
    const { station, flight, date, search } = req.query;
    let query = 'SELECT * FROM declarations WHERE 1=1';
    const params = [];

    if (station && station !== 'ALL') {
      params.push(station.trim().toUpperCase());
      query += ` AND UPPER(origin) = $${params.length}`;
    }
    if (flight) {
      params.push(`%${flight.trim().toUpperCase()}%`);
      query += ` AND UPPER(flight_number) ILIKE $${params.length}`;
    }
    if (date) {
      params.push(date);
      query += ` AND flight_date = $${params.length}`;
    }
    if (search) {
      params.push(`%${search.trim()}%`);
      query += ` AND (passenger_name ILIKE $${params.length} OR declaration_ref ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC LIMIT 200';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur récupération déclarations.' });
  }
});

// 7. Validation individuelle + correction automatique du vol et de l'escale par le scanner
app.patch('/api/staff/declarations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, agent_notes, flight_number, origin } = req.body;
    const userId = req.user.id;

    const cleanFlight = flight_number ? normalizeFlightNumber(flight_number) : null;
    const cleanOrigin = origin ? origin.trim().toUpperCase() : null;

    const result = await pool.query(
      `UPDATE declarations 
       SET status = COALESCE($1, status),
           agent_notes = COALESCE($2, agent_notes),
           flight_number = COALESCE($3, flight_number),
           origin = COALESCE($4, origin),
           verified_by = $5,
           verified_at = CURRENT_TIMESTAMP 
       WHERE id = $6 RETURNING *`,
      [status, agent_notes, cleanFlight, cleanOrigin, userId, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour déclaration.' });
  }
});

// 8. Correction en lot d'un numéro de vol
app.post('/api/staff/bulk-fix-flight', authenticateToken, async (req, res) => {
  try {
    const { station, flightDate, wrongFlight, correctFlight } = req.body;
    if (!flightDate || !wrongFlight || !correctFlight) {
      return res.status(400).json({ error: 'Date, ancien N° de vol et nouveau N° de vol requis.' });
    }

    const cleanWrong = normalizeFlightNumber(wrongFlight);
    const cleanCorrect = normalizeFlightNumber(correctFlight);

    let query = `
      UPDATE declarations
      SET flight_number = $1
      WHERE flight_date = $2 AND UPPER(flight_number) = $3
    `;
    const params = [cleanCorrect, flightDate, cleanWrong];

    if (station && station !== 'ALL') {
      params.push(station.trim().toUpperCase());
      query += ` AND UPPER(origin) = $${params.length}`;
    }

    const result = await pool.query(query, params);
    res.json({
      success: true,
      updatedCount: result.rowCount || 0,
      message: `${result.rowCount || 0} dossier(s) corrigé(s) de ${cleanWrong} vers ${cleanCorrect}.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la correction en lot.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur ASKY Dangerous Goods Réseau actif sur le port ${PORT}`);
});
