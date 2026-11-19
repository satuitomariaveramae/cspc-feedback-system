// Creates the tables (database/schema.sql) and the first admin account.
// Usage:  npm run db:setup      (needs the DB_* variables, and DEFAULT_ADMIN_PASSWORD in production)
require('dotenv').config();
const { db, initDb } = require('./database/db');

initDb()
  .then(() => { console.log('Database ready.'); return db.pool.end(); })
  .catch((e) => { console.error('Database setup failed:', e.message); process.exit(1); });
