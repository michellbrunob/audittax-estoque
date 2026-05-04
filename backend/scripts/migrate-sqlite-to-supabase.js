require('dotenv').config();

const path = require('path');
const Database = require('better-sqlite3');
const { initDatabase, withTransaction, pool } = require('../db/database.js');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'storage', 'estoque.db');

function readTable(sqlite, table) {
  return sqlite.prepare(`SELECT * FROM ${table}`).all();
}

async function wipeTarget(client) {
  await client.query('TRUNCATE TABLE receipt_files, movements, price_history, extra_purchases, maintenance_records, inventory_assets, maintenance_assets, items, receipts, suppliers RESTART IDENTITY CASCADE');
  await client.query('UPDATE cycle SET "lastPurchaseDate" = \'\', "intervalDays" = 60 WHERE id = 1');
  await client.query('UPDATE settings SET "anthropicApiKey" = \'\' WHERE id = 1');
}

async function insertRows(client, table, rows, columnNames) {
  for (const row of rows) {
    const placeholders = columnNames.map((_, index) => `$${index + 1}`).join(', ');
    const columns = columnNames.map((name) => `"${name}"`).join(', ');
    const values = columnNames.map((name) => row[name]);
    await client.query(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, values);
  }
}

async function syncSequence(client, table) {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence($1, 'id'),
      COALESCE((SELECT MAX(id) FROM ${table}), 1),
      (SELECT MAX(id) IS NOT NULL FROM ${table})
    )
  `, [table]);
}

async function main() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  try {
    await initDatabase();

    await withTransaction(async (client) => {
      await wipeTarget(client);

      await insertRows(
        client,
        'suppliers',
        readTable(sqlite, 'suppliers').map((row) => ({ ...row, active: Boolean(row.active) })),
        ['id', 'name', 'tradeName', 'type', 'city', 'state', 'cnpj', 'notes', 'active']
      );
      await insertRows(client, 'receipts', readTable(sqlite, 'receipts'), ['id', 'title', 'value', 'date', 'importedAt', 'notes', 'source', 'supplierId', 'fileName', 'filePath', 'mimeType', 'accessKey', 'queryUrl']);
      await insertRows(client, 'items', readTable(sqlite, 'items'), ['id', 'name', 'unit', 'quantity', 'minStock', 'weeklyConsumption', 'createdByReceiptId']);
      await insertRows(client, 'movements', readTable(sqlite, 'movements'), ['id', 'type', 'itemId', 'quantity', 'date', 'notes', 'receiptId']);
      await insertRows(client, 'price_history', readTable(sqlite, 'price_history'), ['id', 'itemId', 'supplierId', 'market', 'price', 'date', 'receiptId']);
      await insertRows(client, 'extra_purchases', readTable(sqlite, 'extra_purchases'), ['id', 'itemId', 'quantity', 'date', 'cost', 'reason', 'supplierId', 'location']);
      await insertRows(client, 'receipt_files', readTable(sqlite, 'receipt_files'), ['id', 'receiptId', 'kind', 'label', 'fileName', 'filePath', 'mimeType', 'createdAt']);
      await insertRows(
        client,
        'maintenance_assets',
        readTable(sqlite, 'maintenance_assets').map((row) => ({ ...row, active: Boolean(row.active) })),
        ['id', 'category', 'name', 'location', 'brand', 'model', 'serialNumber', 'supplierId', 'supplierName', 'intervalDays', 'lastMaintenanceDate', 'notes', 'btuCapacity', 'acType', 'inkColors', 'poolVolume', 'areaM2', 'filterIntervalDays', 'herbicideIntervalDays', 'lastHerbicideDate', 'active']
      );
      await insertRows(client, 'maintenance_records', readTable(sqlite, 'maintenance_records'), ['id', 'assetId', 'date', 'type', 'description', 'cost', 'technician', 'supplierId', 'notes', 'herbicideProduct', 'herbicideQuantity', 'nextApplicationDate']);
      await insertRows(client, 'inventory_assets', readTable(sqlite, 'inventory_assets'), ['id', 'assetTag', 'barcode', 'serialNumber', 'description', 'department', 'assignedTo', 'purchaseCost', 'stockQuantity', 'purchaseDate', 'brand', 'model', 'fiscalClass', 'depreciationRate', 'supplierId', 'status', 'notes', 'createdAt']);

      const cycle = sqlite.prepare('SELECT * FROM cycle WHERE id = 1').get();
      if (cycle) {
        await client.query('UPDATE cycle SET "lastPurchaseDate" = $1, "intervalDays" = $2 WHERE id = 1', [
          cycle.lastPurchaseDate || '',
          Number(cycle.intervalDays || 60),
        ]);
      }

      const settings = sqlite.prepare('SELECT * FROM settings WHERE id = 1').get();
      if (settings) {
        await client.query('UPDATE settings SET "anthropicApiKey" = $1 WHERE id = 1', [
          settings.anthropicApiKey || '',
        ]);
      }

      await syncSequence(client, 'suppliers');
      await syncSequence(client, 'receipts');
      await syncSequence(client, 'items');
      await syncSequence(client, 'movements');
      await syncSequence(client, 'price_history');
      await syncSequence(client, 'extra_purchases');
      await syncSequence(client, 'receipt_files');
      await syncSequence(client, 'maintenance_assets');
      await syncSequence(client, 'maintenance_records');
      await syncSequence(client, 'inventory_assets');
    });

    console.log(`Migracao concluida com sucesso usando ${SQLITE_PATH}`);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha na migracao SQLite -> Supabase:', error);
  process.exitCode = 1;
});
