const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smart_fleet_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

pool.getConnection()
  .then((c) => { console.log('MySQL connected:', process.env.DB_NAME || 'smart_fleet_db'); c.release(); })
  .catch((e) => console.error('MySQL connection error:', e.message));

module.exports = pool;
