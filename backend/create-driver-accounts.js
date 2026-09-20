// Creates login accounts for all drivers that don't have one yet.
// Email pattern: firstname.lastname@fleet.com, password: password123
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./config/db');

const slug = (n) => String(n).toLowerCase().trim().replace(/[^a-z ]/g, '').split(/\s+/).join('.');

async function run() {
  const [drivers] = await db.query('SELECT id, full_name, user_id FROM drivers ORDER BY id');
  const hash = await bcrypt.hash('password123', 10);
  for (const d of drivers) {
    if (d.user_id) { console.log(`skip ${d.full_name} (already linked to user #${d.user_id})`); continue; }
    const [[ex]] = await db.query('SELECT id FROM users WHERE driver_id=?', [d.id]);
    if (ex) { console.log(`skip ${d.full_name} (already has account)`); continue; }
    let email = `${slug(d.full_name)}@fleet.com`;
    const [[dup]] = await db.query('SELECT id FROM users WHERE email=?', [email]);
    if (dup) email = `driver${d.id}@fleet.com`;
    await db.query("INSERT INTO users (name,email,password,role,driver_id) VALUES (?,?,?,'driver',?)", [d.full_name, email, hash, d.id]);
    const newId = (await db.query('SELECT id FROM users WHERE email=?', [email]))[0][0].id;
    await db.query('UPDATE drivers SET user_id=? WHERE id=? AND user_id IS NULL', [newId, d.id]);
    console.log(`created ${email} -> driver #${d.id} (${d.full_name})`);
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
