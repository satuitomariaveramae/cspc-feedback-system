// One-time helper: creates the database on a managed MySQL (Aiven) and loads database/schema.sql.
// Why Node instead of the mysql command: XAMPP's client cannot do caching_sha2_password (MySQL 8.4).
// Usage (from the project folder):  node scripts/load-schema.js
// The admin password is typed when asked and is never saved to a file.

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const mysql = require('mysql2/promise');

const HOST = process.env.DB_ADMIN_HOST || 'cspc-mysql-cspcfeedback-1b10.j.aivencloud.com';
const PORT = Number(process.env.DB_ADMIN_PORT || 16651);
const ADMIN_USER = process.env.DB_ADMIN_USER || 'avnadmin';
const APP_DB = process.env.DB_NAME || 'cspc_feedback';
const APP_USER = process.env.DB_APP_USER || 'cspc_app';
const CA_PATH = process.env.DB_SSL_CA_FILE ||
  path.join(os.homedir(), 'Documents', 'cspc-secrets', 'ca.pem');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  if (!fs.existsSync(CA_PATH)) {
    console.error('CA certificate not found at: ' + CA_PATH);
    process.exit(1);
  }
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error('schema.sql not found at: ' + schemaPath + '  (run this from the project folder)');
    process.exit(1);
  }

  const password = process.env.DB_ADMIN_PASSWORD || await askHidden(`Password for ${ADMIN_USER}: `);
  let conn;
  try {
    conn = await mysql.createConnection({
      host: HOST,
      port: PORT,
      user: ADMIN_USER,
      password,
      ssl: { ca: fs.readFileSync(CA_PATH, 'utf8'), rejectUnauthorized: true },
      multipleStatements: true,
    });
    console.log('Connected to ' + HOST + ':' + PORT + ' over TLS.');

    await conn.query('CREATE DATABASE IF NOT EXISTS `' + APP_DB + '` CHARACTER SET utf8mb4');
    await conn.query('USE `' + APP_DB + '`');
    await conn.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('Schema loaded into database "' + APP_DB + '".');

    const [tables] = await conn.query('SHOW TABLES');
    console.log('\nTables:');
    tables.forEach((r) => console.log('  - ' + Object.values(r)[0]));

    try {
      const [grants] = await conn.query('SHOW GRANTS FOR ?@?', [APP_USER, '%']);
      console.log('\nGrants for ' + APP_USER + ':');
      grants.forEach((r) => console.log('  ' + Object.values(r)[0]));
    } catch (e) {
      console.log('\n(Could not read grants for ' + APP_USER + ': ' + e.message + ')');
    }
  } catch (err) {
    console.error('\nFailed: ' + err.message);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
})();