const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir les fichiers statiques depuis 'public' ET depuis la racine du projet
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/asky_dg_fih',
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

// Helper de génération de référence unique (ex: ASKY-FIH-8X9K2)
function generateDeclarationRef() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = 'ASKY-FIH-';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Middleware d'authentification Staff
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Accès non autorisé' });

  jwt.verify(token, process.env.JWT_SECRET || 'ASKY_SECRET_KEY_FIH_2026', (err, user) => {
    if (err) return res.status(403).json({ error: 'Jeton invalide ou expiré' });
    req.user = user;
    next();
  });
}

// Route racine explicite pour éviter "Cannot GET /"
app.get('/', (req, res) => {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.status(404).send('Fichier index.html introuvable dans le dépôt.');
});

// 1. POST /api/declarations - Soumission Passager (Portail Public)
app.post('/api/declarations', async (req, res) => {
  try {
    const {
      passenger_name, booking_ref, flight_number, flight_date, origin, destination,
      q1_spare_lithium_powerbanks, q2_carried_on_person_cabin, q3_max_two_powerbanks,
      q4_short_circuit_protection, q5_damaged_defective_swollen, q6_no_checked_baggage,
      q7_no_recharging_onboard, q8_no_charging_other_devices, passenger_signature_ack
    } = req.body;

    if (!passenger_name || !booking_ref || !flight_number || !flight_date || !destination || !passenger_signature_ack) {
      return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis.' });
    }

    let initialStatus = 'SUBMITTED';
    if (q5_damaged_defective_swollen === true) {
      initialStatus = 'REQUIRES_INSPECTION';
    }

    const ref = generateDeclarationRef();
    const query = `
      INSERT INTO declarations (
        declaration_ref, passenger_name, booking_ref, flight_number, flight_date, origin, destination,
        q1_spare_lithium_powerbanks, q2_carried_on_person_cabin, q3_max_two_powerbanks,
        q4_short_circuit_protection, q5_damaged_defective_swollen, q6_no_checked_baggage,
        q7_no_recharging_onboard, q8_no_charging_other_devices, passenger_signature_ack, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING declaration_ref, status, created_at;
    `;

    const values = [
      ref, passenger_name.toUpperCase(), booking_ref.toUpperCase(), flight_number.toUpperCase(),
      flight_date, origin || 'FIH', destination.toUpperCase(),
      q1_spare_lithium_powerbanks, q2_carried_on_person_cabin, q3_max_two_powerbanks,
      q4_short_circuit_protection, q5_damaged_defective_swollen, q6_no_checked_baggage,
      q7_no_recharging_onboard, q8_no_charging_other_devices, passenger_signature_ack, initialStatus
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, declaration: result.rows[0] });

  } catch (err) {
    console.error('Erreur insertion déclaration:', err);
    res.status(500).json({ error: 'Erreur lors de l’enregistrement de la déclaration.' });
  }
});

// 2. POST /api/staff/login - Connexion Agent/Superviseur
app.post('/api/staff/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Identifiants incorrects.' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects.' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET || 'ASKY_SECRET_KEY_FIH_2026',
      { expiresIn: '12h' }
    );

    res.json({ token, user: { username: user.username, role: user.role, full_name: user.full_name } });
  } catch (err) {
    res.status(500).json({ error: 'Erreur d’authentification.' });
  }
});

// 3. GET /api/staff/declarations - Consultation par les agents
app.get('/api/staff/declarations', authenticateToken, async (req, res) => {
  try {
    const { flight, date, search } = req.query;
    let query = 'SELECT * FROM declarations WHERE 1=1';
    const params = [];

    if (flight) {
      params.push(`%${flight}%`);
      query += ` AND flight_number ILIKE $${params.length}`;
    }
    if (date) {
      params.push(date);
      query += ` AND flight_date = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (passenger_name ILIKE $${params.length} OR booking_ref ILIKE $${params.length} OR declaration_ref ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC LIMIT 100';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur récupération déclarations.' });
  }
});

// 4. PATCH /api/staff/declarations/:id - Verification et validation par agent
app.patch('/api/staff/declarations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, agent_notes } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE declarations 
       SET status = $1, agent_notes = $2, verified_by = $3, verified_at = CURRENT_TIMESTAMP 
       WHERE id = $4 RETURNING *`,
      [status, agent_notes, userId, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour déclaration.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur ASKY Dangerous Goods FIH actif sur le port ${PORT}`);
});
