// Deletes ALL feedback submissions (and resets the row ID counter).
// Keeps the admin account(s) and passwords untouched.
// Usage (stop the server first):   node clean-db.js
require('dotenv').config();
const { db } = require('./database/db');

(async () => {
  const { c: before } = await db.get('SELECT COUNT(*) AS c FROM feedbacks');
  await db.run('DELETE FROM feedbacks');
  await db.run('ALTER TABLE feedbacks AUTO_INCREMENT = 1');
  const { c: after } = await db.get('SELECT COUNT(*) AS c FROM feedbacks');
  const { c: admins } = await db.get('SELECT COUNT(*) AS c FROM admins');
  console.log(`Feedbacks deleted: ${before} -> ${after} remaining`);
  console.log(`Admin accounts kept: ${admins}`);
  await db.pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
