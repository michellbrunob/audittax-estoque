require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { RECEIPTS_DIR } = require('../storage/supabaseStorage.js');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const SCHEMA_PATH = path.join(__dirname, '..', 'supabase', 'schema.sql');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';

if (!connectionString) {
  throw new Error('Configure DATABASE_URL com a connection string do Supabase/Postgres.');
}

const ssl = process.env.PGSSLMODE === 'disable'
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl,
  max: Number(process.env.PG_POOL_MAX || 10),
});

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
