require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { RECEIPTS_DIR } = require('../storage/supabaseStorage.js');
const { hashPassword, normalizeUsername } = require('../auth.js');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const SCHEMA_PATH = path.join(__dirname, '..', 'supabase', 'schema.sql');

const ssl = process.env.PGSSLMODE === 'disable'
  ? false
  : { rejectUnauthorized: false };

const pgConfig = {
  ssl,
  max: Number(process.env.PG_POOL_MAX || 10),
};

if (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD) {
  pgConfig.host = process.env.PGHOST;
  pgConfig.port = Number(process.env.PGPORT || 5432);
  pgConfig.database = process.env.PGDATABASE || 'postgres';
  pgConfig.user = process.env.PGUSER;
  pgConfig.password = process.env.PGPASSWORD;
} else {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
  if (!connectionString) {
    throw new Error('Configure DATABASE_URL ou PGHOST/PGUSER/PGPASSWORD para conectar no Supabase/Postgres.');
  }
  pgConfig.connectionString = connectionString;
}

const pool = new Pool(pgConfig);

async function query(text, params = [], client = pool) {
  return client.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function withTransaction(callback) {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initDatabase() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || 'administrador');
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.ADMIN_NAME || 'Administrador';

  await query(schema);
  await query(`
    INSERT INTO cycle (id, "lastPurchaseDate", "intervalDays")
    VALUES (1, '', 60)
    ON CONFLICT (id) DO NOTHING;
  `);
  await query(`
    INSERT INTO settings (id, "anthropicApiKey")
    VALUES (1, '')
    ON CONFLICT (id) DO NOTHING;
  `);
  await query(`
    INSERT INTO users (name, username, "passwordHash", role, active, approved)
    VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
    ON CONFLICT (username) DO UPDATE
    SET name = EXCLUDED.name,
        "passwordHash" = EXCLUDED."passwordHash",
        role = 'admin',
        active = TRUE,
        approved = TRUE,
        "updatedAt" = CURRENT_TIMESTAMP;
  `, [adminName, adminUsername, hashPassword(adminPassword)]);
}

module.exports = {
  pool,
  query,
  getClient,
  withTransaction,
  initDatabase,
  STORAGE_DIR,
  RECEIPTS_DIR,
};
