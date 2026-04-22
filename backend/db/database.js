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

  CREATE TABLE IF NOT EXISTS receipt_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receiptId INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    kind TEXT DEFAULT 'attachment',
    label TEXT DEFAULT '',
    fileName TEXT DEFAULT '',
    filePath TEXT DEFAULT '',
    mimeType TEXT DEFAULT '',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
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

  CREATE TABLE IF NOT EXISTS maintenance_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT 'outro',
    name TEXT NOT NULL DEFAULT '',
    location TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    model TEXT DEFAULT '',
    serialNumber TEXT DEFAULT '',
    supplierId INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    supplierName TEXT DEFAULT '',
    intervalDays INTEGER DEFAULT 180,
    lastMaintenanceDate TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    btuCapacity TEXT DEFAULT '',
    acType TEXT DEFAULT '',
    inkColors TEXT DEFAULT '',
    poolVolume TEXT DEFAULT '',
    areaM2 TEXT DEFAULT '',
    filterIntervalDays INTEGER DEFAULT 180,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS maintenance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assetId INTEGER NOT NULL REFERENCES maintenance_assets(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT DEFAULT 'preventiva',
    description TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    technician TEXT DEFAULT '',
    supplierId INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS inventory_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assetTag TEXT NOT NULL DEFAULT '',
    barcode TEXT DEFAULT '',
    serialNumber TEXT DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    department TEXT DEFAULT '',
    assignedTo TEXT DEFAULT '',
    purchaseCost REAL DEFAULT 0,
    stockQuantity INTEGER DEFAULT 1,
    purchaseDate TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    model TEXT DEFAULT '',
    fiscalClass TEXT DEFAULT 'processamento_dados',
    depreciationRate REAL DEFAULT 20,
    supplierId INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'em_uso',
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function ensureColumn(tableName, columnName, definition) {
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('items', 'createdByReceiptId', 'INTEGER REFERENCES receipts(id) ON DELETE SET NULL');
ensureColumn('movements', 'receiptId', 'INTEGER REFERENCES receipts(id) ON DELETE SET NULL');
ensureColumn('price_history', 'receiptId', 'INTEGER REFERENCES receipts(id) ON DELETE SET NULL');
ensureColumn('maintenance_assets', 'herbicideIntervalDays', "INTEGER DEFAULT 30");
ensureColumn('maintenance_assets', 'lastHerbicideDate', "TEXT DEFAULT ''");
ensureColumn('maintenance_records', 'herbicideProduct', "TEXT DEFAULT ''");
ensureColumn('maintenance_records', 'herbicideQuantity', "TEXT DEFAULT ''");
ensureColumn('maintenance_records', 'nextApplicationDate', "TEXT DEFAULT ''");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_items_created_by_receipt ON items(createdByReceiptId);
  CREATE INDEX IF NOT EXISTS idx_movements_receipt_id ON movements(receiptId);
  CREATE INDEX IF NOT EXISTS idx_price_history_receipt_id ON price_history(receiptId);
  CREATE INDEX IF NOT EXISTS idx_receipt_files_receipt_id ON receipt_files(receiptId);
`);

module.exports = { db, DB_PATH, STORAGE_DIR, RECEIPTS_DIR };
