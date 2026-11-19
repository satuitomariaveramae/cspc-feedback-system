const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

// ---------- Connection settings (all from environment variables) ----------
function sslOption() {
  // TLS is ON by default in production. Set DB_SSL=false only for local MySQL.
  const flag = (process.env.DB_SSL || (isProd ? 'true' : 'false')).toLowerCase();
  if (flag !== 'true') return undefined;
  const ssl = { rejectUnauthorized: true };
  if (process.env.DB_SSL_CA) ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
  return ssl;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslOption(),
  connectionLimit: 5,
  waitForConnections: true,
  charset: 'utf8mb4',
  timezone: 'Z',        // JS Dates are sent as UTC
  dateStrings: true     // DATETIME comes back as 'YYYY-MM-DD HH:MM:SS' (UTC), like before
});

// Make CURRENT_TIMESTAMP / NOW() UTC on every connection.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

// ---------- Small query helpers ----------
async function all(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0];
}
async function run(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result; // { insertId, affectedRows, ... }
}

// JS Date -> 'YYYY-MM-DD HH:MM:SS' (UTC) for DATETIME columns
function toSqlDate(d = new Date()) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const db = { pool, all, get, run, toSqlDate };

// ---------- Schema + default admin (runs once at startup) ----------
async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = schema
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const stmt of statements) await run(stmt);

  const { c } = await get('SELECT COUNT(*) AS c FROM admins');
  if (c === 0) {
    const password = process.env.DEFAULT_ADMIN_PASSWORD || (isProd ? null : 'cspc-admin2026');
    if (!password) {
      throw new Error('No admin account exists. Set DEFAULT_ADMIN_PASSWORD in the environment to create one.');
    }
    await run(
      'INSERT INTO admins (username, password_hash, full_name, role, email) VALUES (?, ?, ?, ?, ?)',
      ['admin', bcrypt.hashSync(password, 10), 'CSPC System Administrator', 'Super Admin', process.env.DEFAULT_ADMIN_EMAIL || null]
    );
    console.log('Seeded default admin -> username: admin');
  }

  if (process.env.DEFAULT_ADMIN_EMAIL) {
    await run(
      `UPDATE admins SET email = ? WHERE username = 'admin' AND (email IS NULL OR email = '')`,
      [process.env.DEFAULT_ADMIN_EMAIL]
    );
  }
}

// ---------- Ticket number generator ----------
// Random and non-sequential, e.g. CSPC-2026-K7M49QXB
// 32^8 = over 1 trillion combinations, so it can't be guessed.
// Skips look-alike characters (0/O, 1/I) so it is easy to read and type.
const TICKET_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateTicketNo() {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) code += TICKET_CHARS[bytes[i] % TICKET_CHARS.length];
    const ticket = `CSPC-${year}-${code}`;
    const taken = await get('SELECT 1 FROM feedbacks WHERE ticket_no = ?', [ticket]);
    if (!taken) return ticket;
  }
  throw new Error('Could not generate a unique ticket number');
}

module.exports = { db, initDb, generateTicketNo };
