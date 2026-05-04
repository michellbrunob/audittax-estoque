require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { pool } = require('../db/database.js');
const {
  RECEIPTS_DIR,
  ensureStorageEnabled,
  uploadLocalReceiptFile,
} = require('../storage/supabaseStorage.js');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'storage', 'estoque.db');

function listRows(db, table) {
  return db.prepare(`SELECT "filePath" AS "filePath", "mimeType" AS "mimeType" FROM ${table} WHERE "filePath" IS NOT NULL AND "filePath" != ''`).all();
}

async function main() {
  ensureStorageEnabled();
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  try {
    const rows = [
      ...listRows(sqlite, 'receipts'),
      ...listRows(sqlite, 'receipt_files'),
    ];

    let uploaded = 0;
    for (const row of rows) {
      const localPath = path.join(RECEIPTS_DIR, row.filePath);
      if (!fs.existsSync(localPath)) continue;
      await uploadLocalReceiptFile(localPath, row.filePath, row.mimeType || 'application/octet-stream');
      uploaded += 1;
    }

    console.log(`Upload concluido para ${uploaded} comprovante(s)/anexo(s).`);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha ao enviar comprovantes para o Supabase Storage:', error);
  process.exitCode = 1;
});
