// Crée la base bab_al_fkamah et insère les données initiales.
// Usage : npm run init-db   (compte DB_ADMIN_USER / DB_ADMIN_PASSWORD du fichier .env)
// ATTENTION : supprime et recrée la base.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'root',
    password: process.env.DB_ADMIN_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    multipleStatements: true, charset: 'utf8mb4'
  });
  const o = -new Date().getTimezoneOffset();
  await conn.query(`SET time_zone = '${o >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}:${String(Math.abs(o) % 60).padStart(2, '0')}'`);
  for (const f of ['schema.sql', 'seed.sql']) {
    process.stdout.write(`→ ${f} ... `);
    await conn.query(fs.readFileSync(path.join(__dirname, '..', 'database', f), 'utf8'));
    console.log('OK');
  }
  await conn.end();
  console.log('Base bab_al_fkamah prête. Connectez-vous avec admin / admin123');
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
