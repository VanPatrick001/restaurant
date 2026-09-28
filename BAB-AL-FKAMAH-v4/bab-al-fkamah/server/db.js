const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bab_al_fkamah',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  dateStrings: false,
  timezone: 'local'
});

// MySQL utilise le même fuseau horaire que le serveur Node (évite les décalages d'heures)
function fuseauNode() {
  const o = -new Date().getTimezoneOffset();
  return `${o >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}:${String(Math.abs(o) % 60).padStart(2, '0')}`;
}
pool.on('connection', conn => { conn.query(`SET time_zone = '${fuseauNode()}'`); });

async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const helper = {
      q: async (s, p = []) => (await conn.query(s, p))[0],
      one: async (s, p = []) => ((await conn.query(s, p))[0][0] || null)
    };
    const res = await fn(helper);
    await conn.commit();
    return res;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { pool, q, one, tx, fuseauNode };
