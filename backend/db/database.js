const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const RECEIPTS_DIR = path.join(STORAGE_DIR, 'receipts');
const DB_PATH = path.join(STORAGE_DIR, 'estoque.db');

// Garante diretórios
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Performance: WAL mode para leituras concorrentes (LAN multi-user)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    tradeName TEXT DEFAULT '',
    type TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    cnpj TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT DEFAULT 'un',
    quantity REAL DEFAULT 0,
    minStock REAL DEFAULT 0,
    weeklyConsumption REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('entrada','saida','avulso')),
    itemId INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    itemId INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    supplierId INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    market TEXT DEFAULT '',
    price REAL NOT NULL,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS extra_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    itemId INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    date TEXT NOT NULL,
    cost REAL DEFAULT 0,
    reason TEXT DEFAULT '',
    supplierId INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    location TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    value REAL DEFAULT 0,
    date TEXT NOT NULL DEFAULT '',
    importedAt TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    source TEXT DEFAULT '',
    supplierId INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    fileName TEXT DEFAULT '',
    filePath TEXT DEFAULT '',
    mimeType TEXT DEFAULT '',
    accessKey TEXT DEFAULT '',
    queryUrl TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS cycle (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    lastPurchaseDate TEXT NOT NULL DEFAULT '',
    intervalDays INTEGER DEFAULT 60
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    anthropicApiKey TEXT DEFAULT ''
  );

  -- Seed singletons
  INSERT OR IGNORE INTO cycle (id, lastPurchaseDate, intervalDays) VALUES (1, '', 60);
  INSERT OR IGNORE INTO settings (id, anthropicApiKey) VALUES (1, '');
`);

module.exports = { db, DB_PATH, STORAGE_DIR, RECEIPTS_DIR };
