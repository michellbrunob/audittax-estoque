CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  "tradeName" TEXT DEFAULT '',
  type TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  cnpj TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT DEFAULT 'un',
  quantity NUMERIC DEFAULT 0,
  "minStock" NUMERIC DEFAULT 0,
  "weeklyConsumption" NUMERIC DEFAULT 0,
  "createdByReceiptId" BIGINT
);

CREATE TABLE IF NOT EXISTS receipts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT DEFAULT '',
  value NUMERIC DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',
  "importedAt" TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  source TEXT DEFAULT '',
  "supplierId" BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  "fileName" TEXT DEFAULT '',
  "filePath" TEXT DEFAULT '',
  "mimeType" TEXT DEFAULT '',
  "accessKey" TEXT DEFAULT '',
  "queryUrl" TEXT DEFAULT ''
);

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_createdbyreceiptid_fkey;
ALTER TABLE items
  ADD CONSTRAINT items_createdbyreceiptid_fkey
  FOREIGN KEY ("createdByReceiptId") REFERENCES receipts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS movements (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('entrada', 'saida', 'avulso')),
  "itemId" BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  "receiptId" BIGINT REFERENCES receipts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,
  "itemId" BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  "supplierId" BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  market TEXT DEFAULT '',
  price NUMERIC NOT NULL,
  date TEXT NOT NULL,
  "receiptId" BIGINT REFERENCES receipts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS extra_purchases (
  id BIGSERIAL PRIMARY KEY,
  "itemId" BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  date TEXT NOT NULL,
  cost NUMERIC DEFAULT 0,
  reason TEXT DEFAULT '',
  "supplierId" BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  location TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS receipt_files (
  id BIGSERIAL PRIMARY KEY,
  "receiptId" BIGINT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'attachment',
  label TEXT DEFAULT '',
  "fileName" TEXT DEFAULT '',
  "filePath" TEXT DEFAULT '',
  "mimeType" TEXT DEFAULT '',
  "createdAt" TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cycle (
  id INTEGER PRIMARY KEY,
  "lastPurchaseDate" TEXT NOT NULL DEFAULT '',
  "intervalDays" INTEGER DEFAULT 60
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  "anthropicApiKey" TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  approved BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maintenance_assets (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'outro',
  name TEXT NOT NULL DEFAULT '',
  location TEXT DEFAULT '',
  brand TEXT DEFAULT '',
  model TEXT DEFAULT '',
  "serialNumber" TEXT DEFAULT '',
  "supplierId" BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  "supplierName" TEXT DEFAULT '',
  "intervalDays" INTEGER DEFAULT 180,
  "lastMaintenanceDate" TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  "btuCapacity" TEXT DEFAULT '',
  "acType" TEXT DEFAULT '',
  "inkColors" TEXT DEFAULT '',
  "poolVolume" TEXT DEFAULT '',
  "areaM2" TEXT DEFAULT '',
  "filterIntervalDays" INTEGER DEFAULT 180,
  "herbicideIntervalDays" INTEGER DEFAULT 30,
  "lastHerbicideDate" TEXT DEFAULT '',
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id BIGSERIAL PRIMARY KEY,
  "assetId" BIGINT NOT NULL REFERENCES maintenance_assets(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT DEFAULT 'preventiva',
  description TEXT DEFAULT '',
  cost NUMERIC DEFAULT 0,
  technician TEXT DEFAULT '',
  "supplierId" BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  "herbicideProduct" TEXT DEFAULT '',
  "herbicideQuantity" TEXT DEFAULT '',
  "nextApplicationDate" TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inventory_assets (
  id BIGSERIAL PRIMARY KEY,
  "assetTag" TEXT NOT NULL DEFAULT '',
  barcode TEXT DEFAULT '',
  "serialNumber" TEXT DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  department TEXT DEFAULT '',
  "assignedTo" TEXT DEFAULT '',
  "purchaseCost" NUMERIC DEFAULT 0,
  "stockQuantity" INTEGER DEFAULT 1,
  "purchaseDate" TEXT DEFAULT '',
  brand TEXT DEFAULT '',
  model TEXT DEFAULT '',
  "fiscalClass" TEXT DEFAULT 'processamento_dados',
  "depreciationRate" NUMERIC DEFAULT 20,
  "supplierId" BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'em_uso',
  notes TEXT DEFAULT '',
  "createdAt" TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_created_by_receipt ON items("createdByReceiptId");
CREATE INDEX IF NOT EXISTS idx_movements_receipt_id ON movements("receiptId");
CREATE INDEX IF NOT EXISTS idx_price_history_receipt_id ON price_history("receiptId");
CREATE INDEX IF NOT EXISTS idx_receipt_files_receipt_id ON receipt_files("receiptId");
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
