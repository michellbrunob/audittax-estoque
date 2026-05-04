const fs = require('fs');
const path = require('path');
const { query, withTransaction, RECEIPTS_DIR } = require('./database.js');
const { uploadReceiptBuffer, deleteReceiptObject } = require('../storage/supabaseStorage.js');

const bool = (value) => value !== false;
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeItem = (row) => row ? ({
  ...row,
  id: Number(row.id),
  quantity: toNumber(row.quantity),
  minStock: toNumber(row.minStock),
  weeklyConsumption: toNumber(row.weeklyConsumption),
  createdByReceiptId: row.createdByReceiptId == null ? null : Number(row.createdByReceiptId),
}) : null;

const normalizeMovement = (row) => row ? ({
  ...row,
  id: Number(row.id),
  itemId: Number(row.itemId),
  quantity: toNumber(row.quantity),
  receiptId: row.receiptId == null ? null : Number(row.receiptId),
}) : null;

const normalizePrice = (row) => row ? ({
  ...row,
  id: Number(row.id),
  itemId: Number(row.itemId),
  supplierId: row.supplierId == null ? null : Number(row.supplierId),
  price: toNumber(row.price),
  receiptId: row.receiptId == null ? null : Number(row.receiptId),
}) : null;

const normalizeExtra = (row) => row ? ({
  ...row,
  id: Number(row.id),
  itemId: Number(row.itemId),
  quantity: toNumber(row.quantity),
  cost: toNumber(row.cost),
  supplierId: row.supplierId == null ? null : Number(row.supplierId),
}) : null;

const normalizeSupplier = (row) => row ? ({
  ...row,
  id: Number(row.id),
  active: Boolean(row.active),
}) : null;

const normalizeReceipt = (row) => row ? ({
  ...row,
  id: Number(row.id),
  value: toNumber(row.value),
  supplierId: row.supplierId == null ? null : Number(row.supplierId),
}) : null;

const normalizeReceiptFile = (row) => row ? ({
  ...row,
  id: Number(row.id),
  receiptId: Number(row.receiptId),
}) : null;

const normalizeCycle = (row) => row ? ({
  lastPurchaseDate: row.lastPurchaseDate || '',
  intervalDays: toNumber(row.intervalDays, 60),
}) : { lastPurchaseDate: '', intervalDays: 60 };

const normalizeSettings = (row) => row ? ({
  anthropicApiKey: row.anthropicApiKey || '',
}) : { anthropicApiKey: '' };

const normalizeAsset = (row) => row ? ({
  ...row,
  id: Number(row.id),
  supplierId: row.supplierId == null ? null : Number(row.supplierId),
  intervalDays: toNumber(row.intervalDays, 180),
  filterIntervalDays: toNumber(row.filterIntervalDays, 180),
  herbicideIntervalDays: toNumber(row.herbicideIntervalDays, 30),
  active: Boolean(row.active),
}) : null;

const normalizeRecord = (row) => row ? ({
  ...row,
  id: Number(row.id),
  assetId: Number(row.assetId),
  supplierId: row.supplierId == null ? null : Number(row.supplierId),
  cost: toNumber(row.cost),
}) : null;

const normalizeInventoryAsset = (row) => row ? ({
  ...row,
  id: Number(row.id),
  purchaseCost: toNumber(row.purchaseCost),
  stockQuantity: toNumber(row.stockQuantity, 1),
  depreciationRate: toNumber(row.depreciationRate, 20),
  supplierId: row.supplierId == null ? null : Number(row.supplierId),
}) : null;

async function getAllItems(client) {
  const { rows } = await query('SELECT * FROM items ORDER BY name', [], client);
  return rows.map(normalizeItem);
}

async function getItem(id, client) {
  const { rows } = await query('SELECT * FROM items WHERE id = $1', [id], client);
  return normalizeItem(rows[0]);
}

async function insertItem(payload, client) {
  const params = [
    payload.name || '',
    payload.unit || 'un',
    toNumber(payload.quantity),
    toNumber(payload.minStock),
    toNumber(payload.weeklyConsumption),
    payload.createdByReceiptId || null,
  ];
  const { rows } = await query(`
    INSERT INTO items (name, unit, quantity, "minStock", "weeklyConsumption", "createdByReceiptId")
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, params, client);
  return normalizeItem(rows[0]);
}

async function updateItem(id, payload, client) {
  const params = [
    payload.name || '',
    payload.unit || 'un',
    toNumber(payload.quantity),
    toNumber(payload.minStock),
    toNumber(payload.weeklyConsumption),
    id,
  ];
  await query(`
    UPDATE items
    SET name = $1, unit = $2, quantity = $3, "minStock" = $4, "weeklyConsumption" = $5
    WHERE id = $6
  `, params, client);
  return getItem(id, client);
}

async function deleteItem(id, client) {
  await query('DELETE FROM items WHERE id = $1', [id], client);
}

async function updateItemQty(id, quantity, client) {
  await query('UPDATE items SET quantity = $1 WHERE id = $2', [quantity, id], client);
}

async function updateItemConsumption(id, weeklyConsumption, client) {
  await query('UPDATE items SET "weeklyConsumption" = $1 WHERE id = $2', [weeklyConsumption, id], client);
}

async function getAllMovements(client) {
  const { rows } = await query('SELECT * FROM movements ORDER BY date DESC, id DESC', [], client);
  return rows.map(normalizeMovement);
}

async function insertMovement(payload) {
  return withTransaction(async (client) => {
    const item = await getItem(payload.itemId, client);
    const movementDate = payload.date || new Date().toISOString().slice(0, 10);
    const { rows } = await query(`
      INSERT INTO movements (type, "itemId", quantity, date, notes, "receiptId")
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      payload.type,
      payload.itemId,
      toNumber(payload.quantity),
      movementDate,
      payload.notes || '',
      payload.receiptId || null,
    ], client);

    if (item) {
      let nextQuantity = toNumber(item.quantity);
      if (payload.type === 'entrada' || payload.type === 'avulso') {
        nextQuantity += toNumber(payload.quantity);
      } else if (payload.type === 'saida') {
        nextQuantity = Math.max(0, nextQuantity - toNumber(payload.quantity));
      }
      await updateItemQty(payload.itemId, nextQuantity, client);
    }

    return normalizeMovement(rows[0]);
  });
}

async function getAllPrices(client) {
  const { rows } = await query('SELECT * FROM price_history ORDER BY date DESC, id DESC', [], client);
  return rows.map(normalizePrice);
}

async function insertPrice(payload, client) {
  const { rows } = await query(`
    INSERT INTO price_history ("itemId", "supplierId", market, price, date, "receiptId")
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [
    payload.itemId,
    payload.supplierId || null,
    payload.market || '',
    toNumber(payload.price),
    payload.date || new Date().toISOString().slice(0, 10),
    payload.receiptId || null,
  ], client);
  return normalizePrice(rows[0]);
}

async function getAllExtras(client) {
  const { rows } = await query('SELECT * FROM extra_purchases ORDER BY date DESC, id DESC', [], client);
  return rows.map(normalizeExtra);
}

async function insertExtra(payload, client) {
  const { rows } = await query(`
    INSERT INTO extra_purchases ("itemId", quantity, date, cost, reason, "supplierId", location)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    payload.itemId,
    toNumber(payload.quantity),
    payload.date || new Date().toISOString().slice(0, 10),
    toNumber(payload.cost),
    payload.reason || '',
    payload.supplierId || null,
    payload.location || '',
  ], client);
  return normalizeExtra(rows[0]);
}

async function getReceiptImportSummary(receiptId, client) {
  const [{ count: movementCount }, { count: priceCount }, { count: createdItemCount }] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM movements WHERE "receiptId" = $1', [receiptId], client).then((result) => result.rows[0]),
    query('SELECT COUNT(*)::int AS count FROM price_history WHERE "receiptId" = $1', [receiptId], client).then((result) => result.rows[0]),
    query('SELECT COUNT(*)::int AS count FROM items WHERE "createdByReceiptId" = $1', [receiptId], client).then((result) => result.rows[0]),
  ]);

  return {
    movementCount: Number(movementCount || 0),
    priceCount: Number(priceCount || 0),
    createdItemCount: Number(createdItemCount || 0),
    canRevertImport: Number(movementCount || 0) > 0 || Number(priceCount || 0) > 0 || Number(createdItemCount || 0) > 0,
  };
}

async function hydrateReceipt(receipt, client) {
  if (!receipt) return null;

  const attachments = [];
  if (receipt.filePath) {
    attachments.push({
      id: `primary-${receipt.id}`,
      receiptId: receipt.id,
      kind: 'primary',
      label: receipt.mimeType?.includes('xml') ? 'XML principal' : receipt.mimeType?.includes('pdf') ? 'PDF principal' : 'Arquivo principal',
      fileName: receipt.fileName || '',
      filePath: receipt.filePath || '',
      mimeType: receipt.mimeType || '',
      isPrimary: true,
    });
  }

  const fileResult = await query('SELECT * FROM receipt_files WHERE "receiptId" = $1 ORDER BY id', [receipt.id], client);
  fileResult.rows.map(normalizeReceiptFile).forEach((file) => {
    attachments.push({ ...file, isPrimary: false });
  });

  return {
    ...receipt,
    hasFile: Boolean(receipt.filePath),
    attachments,
    importSummary: await getReceiptImportSummary(receipt.id, client),
  };
}

async function getAllReceipts(client) {
  const { rows } = await query('SELECT * FROM receipts ORDER BY date DESC, id DESC', [], client);
  const receipts = rows.map(normalizeReceipt);
  return Promise.all(receipts.map((receipt) => hydrateReceipt(receipt, client)));
}

async function getReceipt(id, client) {
  const { rows } = await query('SELECT * FROM receipts WHERE id = $1', [id], client);
  return hydrateReceipt(normalizeReceipt(rows[0]), client);
}

async function insertReceipt(payload, filePath = '', client) {
  const { rows } = await query(`
    INSERT INTO receipts (title, value, date, "importedAt", notes, source, "supplierId", "fileName", "filePath", "mimeType", "accessKey", "queryUrl")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [
    payload.title || '',
    toNumber(payload.value),
    payload.date || new Date().toISOString().slice(0, 10),
    payload.importedAt || new Date().toISOString(),
    payload.notes || '',
    payload.source || '',
    payload.supplierId || null,
    payload.fileName || '',
    filePath || '',
    payload.mimeType || '',
    payload.accessKey || '',
    payload.queryUrl || '',
  ], client);
  return normalizeReceipt(rows[0]);
}

async function deleteReceiptFile(receipt) {
  if (!receipt?.filePath) return;
  await deleteReceiptObject(receipt.filePath);
}

async function deleteAttachmentFiles(attachments) {
  await Promise.all(attachments.map((file) => (
    file?.filePath ? deleteReceiptObject(file.filePath) : Promise.resolve()
  )));
}

function movementImpact(type, quantity) {
  const amount = toNumber(quantity);
  return type === 'saida' ? -amount : amount;
}

async function deleteReceipt(id, mode = 'receipt-only') {
  const cleanup = { receipt: null, attachments: [] };

  const result = await withTransaction(async (client) => {
    const receipt = await getReceipt(id, client);
    if (!receipt) {
      return { ok: true, mode, deletedReceiptId: id, importSummary: await getReceiptImportSummary(id, client) };
    }

    cleanup.receipt = receipt;
    cleanup.attachments = receipt.attachments.filter((file) => !file.isPrimary);

    if (mode === 'revert-import') {
      const linkedMovements = (await query(`
        SELECT id, type, "itemId", quantity
        FROM movements
        WHERE "receiptId" = $1
        ORDER BY id
      `, [id], client)).rows.map(normalizeMovement);

      const linkedCreatedItems = (await query(`
        SELECT id, name, quantity
        FROM items
        WHERE "createdByReceiptId" = $1
        ORDER BY id
      `, [id], client)).rows.map(normalizeItem);

      const stockAdjustments = new Map();

      linkedMovements.forEach((movement) => {
        const current = stockAdjustments.get(movement.itemId) || 0;
        stockAdjustments.set(movement.itemId, current + movementImpact(movement.type, movement.quantity));
      });

      for (const [itemId, importedDelta] of stockAdjustments.entries()) {
        const item = await getItem(itemId, client);
        if (!item) continue;
        const nextQty = toNumber(item.quantity) - importedDelta;
        if (nextQty < 0) {
          throw new Error(`Nao foi possivel reverter a importacao do item "${item.name}". O estoque atual ja foi consumido parcialmente.`);
        }
      }

      for (const [itemId, importedDelta] of stockAdjustments.entries()) {
        const item = await getItem(itemId, client);
        if (!item) continue;
        await updateItemQty(itemId, Number((toNumber(item.quantity) - importedDelta).toFixed(4)), client);
      }

      await query('DELETE FROM movements WHERE "receiptId" = $1', [id], client);
      await query('DELETE FROM price_history WHERE "receiptId" = $1', [id], client);

      for (const item of linkedCreatedItems) {
        const { rows } = await query(`
          SELECT (
            (SELECT COUNT(*) FROM movements WHERE "itemId" = $1 AND ("receiptId" IS NULL OR "receiptId" != $2)) +
            (SELECT COUNT(*) FROM price_history WHERE "itemId" = $1 AND ("receiptId" IS NULL OR "receiptId" != $2)) +
            (SELECT COUNT(*) FROM extra_purchases WHERE "itemId" = $1)
          )::int AS total
        `, [item.id, id], client);
        if (Number(rows[0]?.total || 0) === 0) {
          await deleteItem(item.id, client);
        }
      }
    }

    await query('DELETE FROM receipts WHERE id = $1', [id], client);

    return {
      ok: true,
      mode,
      deletedReceiptId: id,
      importSummary: receipt.importSummary || await getReceiptImportSummary(id, client),
    };
  });

  await deleteAttachmentFiles(cleanup.attachments);
  await deleteReceiptFile(cleanup.receipt);
  return result;
}

async function getAllSuppliers(client) {
  const { rows } = await query('SELECT * FROM suppliers ORDER BY name', [], client);
  return rows.map(normalizeSupplier);
}

async function getSupplier(id, client) {
  const { rows } = await query('SELECT * FROM suppliers WHERE id = $1', [id], client);
  return normalizeSupplier(rows[0]);
}

async function insertSupplier(payload, client) {
  const { rows } = await query(`
    INSERT INTO suppliers (name, "tradeName", type, city, state, cnpj, notes, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    payload.name || '',
    payload.tradeName || '',
    payload.type || '',
    payload.city || '',
    payload.state || '',
    payload.cnpj || '',
    payload.notes || '',
    bool(payload.active),
  ], client);
  return normalizeSupplier(rows[0]);
}

async function updateSupplier(id, payload, client) {
  await query(`
    UPDATE suppliers
    SET name = $1, "tradeName" = $2, type = $3, city = $4, state = $5, cnpj = $6, notes = $7, active = $8
    WHERE id = $9
  `, [
    payload.name || '',
    payload.tradeName || '',
    payload.type || '',
    payload.city || '',
    payload.state || '',
    payload.cnpj || '',
    payload.notes || '',
    bool(payload.active),
    id,
  ], client);
  return getSupplier(id, client);
}

async function deleteSupplier(id, client) {
  const { rows } = await query(`
    SELECT (
      (SELECT COUNT(*) FROM price_history WHERE "supplierId" = $1) +
      (SELECT COUNT(*) FROM extra_purchases WHERE "supplierId" = $1) +
      (SELECT COUNT(*) FROM receipts WHERE "supplierId" = $1)
    )::int AS total
  `, [id], client);
  const total = Number(rows[0]?.total || 0);
  if (total > 0) return { error: 'Fornecedor tem registros vinculados', refs: total };
  await query('DELETE FROM suppliers WHERE id = $1', [id], client);
  return { ok: true };
}

async function getCycle(client) {
  const { rows } = await query('SELECT * FROM cycle WHERE id = 1', [], client);
  return normalizeCycle(rows[0]);
}

async function updateCycle(payload, client) {
  await query(`
    UPDATE cycle
    SET "lastPurchaseDate" = $1, "intervalDays" = $2
    WHERE id = 1
  `, [
    payload.lastPurchaseDate || '',
    toNumber(payload.intervalDays, 60),
  ], client);
  return getCycle(client);
}

async function getSettings(client) {
  const { rows } = await query('SELECT * FROM settings WHERE id = 1', [], client);
  return normalizeSettings(rows[0]);
}

async function updateSettings(payload, client) {
  await query('UPDATE settings SET "anthropicApiKey" = $1 WHERE id = 1', [payload.anthropicApiKey || ''], client);
  return getSettings(client);
}

async function getAllAssets(client) {
  const { rows } = await query('SELECT * FROM maintenance_assets ORDER BY name', [], client);
  return rows.map(normalizeAsset);
}

async function getAsset(id, client) {
  const { rows } = await query('SELECT * FROM maintenance_assets WHERE id = $1', [id], client);
  return normalizeAsset(rows[0]);
}

async function insertAsset(payload, client) {
  const { rows } = await query(`
    INSERT INTO maintenance_assets (
      category, name, location, brand, model, "serialNumber", "supplierId", "supplierName",
      "intervalDays", "lastMaintenanceDate", notes, "btuCapacity", "acType", "inkColors",
      "poolVolume", "areaM2", "filterIntervalDays", "herbicideIntervalDays", "lastHerbicideDate", active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *
  `, [
    payload.category || 'outro',
    payload.name || '',
    payload.location || '',
    payload.brand || '',
    payload.model || '',
    payload.serialNumber || '',
    payload.supplierId || null,
    payload.supplierName || '',
    toNumber(payload.intervalDays, 180),
    payload.lastMaintenanceDate || '',
    payload.notes || '',
    payload.btuCapacity || '',
    payload.acType || '',
    payload.inkColors || '',
    payload.poolVolume || '',
    payload.areaM2 || '',
    toNumber(payload.filterIntervalDays, 180),
    toNumber(payload.herbicideIntervalDays, 30),
    payload.lastHerbicideDate || '',
    bool(payload.active),
  ], client);
  return normalizeAsset(rows[0]);
}

async function updateAsset(id, payload, client) {
  await query(`
    UPDATE maintenance_assets
    SET category = $1, name = $2, location = $3, brand = $4, model = $5, "serialNumber" = $6,
        "supplierId" = $7, "supplierName" = $8, "intervalDays" = $9, "lastMaintenanceDate" = $10,
        notes = $11, "btuCapacity" = $12, "acType" = $13, "inkColors" = $14, "poolVolume" = $15,
        "areaM2" = $16, "filterIntervalDays" = $17, "herbicideIntervalDays" = $18, "lastHerbicideDate" = $19,
        active = $20
    WHERE id = $21
  `, [
    payload.category || 'outro',
    payload.name || '',
    payload.location || '',
    payload.brand || '',
    payload.model || '',
    payload.serialNumber || '',
    payload.supplierId || null,
    payload.supplierName || '',
    toNumber(payload.intervalDays, 180),
    payload.lastMaintenanceDate || '',
    payload.notes || '',
    payload.btuCapacity || '',
    payload.acType || '',
    payload.inkColors || '',
    payload.poolVolume || '',
    payload.areaM2 || '',
    toNumber(payload.filterIntervalDays, 180),
    toNumber(payload.herbicideIntervalDays, 30),
    payload.lastHerbicideDate || '',
    bool(payload.active),
    id,
  ], client);
  return getAsset(id, client);
}

async function deleteAsset(id, client) {
  await query('DELETE FROM maintenance_assets WHERE id = $1', [id], client);
}

async function getAllRecords(client) {
  const { rows } = await query('SELECT * FROM maintenance_records ORDER BY date DESC, id DESC', [], client);
  return rows.map(normalizeRecord);
}

async function insertRecord(payload) {
  return withTransaction(async (client) => {
    const date = payload.date || new Date().toISOString().slice(0, 10);
    const { rows } = await query(`
      INSERT INTO maintenance_records (
        "assetId", date, type, description, cost, technician, "supplierId", notes, "herbicideProduct", "herbicideQuantity", "nextApplicationDate"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      Number(payload.assetId),
      date,
      payload.type || 'preventiva',
      payload.description || '',
      toNumber(payload.cost),
      payload.technician || '',
      payload.supplierId || null,
      payload.notes || '',
      payload.herbicideProduct || '',
      payload.herbicideQuantity || '',
      payload.nextApplicationDate || '',
    ], client);

    if ((payload.type || 'preventiva') === 'aplicacao_herbicida') {
      await query('UPDATE maintenance_assets SET "lastHerbicideDate" = $1 WHERE id = $2', [date, Number(payload.assetId)], client);
    } else {
      await query('UPDATE maintenance_assets SET "lastMaintenanceDate" = $1 WHERE id = $2', [date, Number(payload.assetId)], client);
    }

    return normalizeRecord(rows[0]);
  });
}

async function deleteRecord(id, client) {
  await query('DELETE FROM maintenance_records WHERE id = $1', [id], client);
}

async function getAllInventoryAssets(client) {
  const { rows } = await query('SELECT * FROM inventory_assets ORDER BY description, "assetTag"', [], client);
  return rows.map(normalizeInventoryAsset);
}

async function getInventoryAsset(id, client) {
  const { rows } = await query('SELECT * FROM inventory_assets WHERE id = $1', [id], client);
  return normalizeInventoryAsset(rows[0]);
}

async function insertInventoryAsset(payload, client) {
  const { rows } = await query(`
    INSERT INTO inventory_assets (
      "assetTag", barcode, "serialNumber", description, department, "assignedTo", "purchaseCost",
      "stockQuantity", "purchaseDate", brand, model, "fiscalClass", "depreciationRate", "supplierId", status, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *
  `, [
    payload.assetTag || '',
    payload.barcode || '',
    payload.serialNumber || '',
    payload.description || '',
    payload.department || '',
    payload.assignedTo || '',
    toNumber(payload.purchaseCost),
    Math.max(0, toNumber(payload.stockQuantity, 1)),
    payload.purchaseDate || '',
    payload.brand || '',
    payload.model || '',
    payload.fiscalClass || 'processamento_dados',
    toNumber(payload.depreciationRate, 20),
    payload.supplierId || null,
    payload.status || 'em_uso',
    payload.notes || '',
  ], client);
  return normalizeInventoryAsset(rows[0]);
}

async function updateInventoryAsset(id, payload, client) {
  await query(`
    UPDATE inventory_assets
    SET "assetTag" = $1, barcode = $2, "serialNumber" = $3, description = $4, department = $5,
        "assignedTo" = $6, "purchaseCost" = $7, "stockQuantity" = $8, "purchaseDate" = $9,
        brand = $10, model = $11, "fiscalClass" = $12, "depreciationRate" = $13, "supplierId" = $14,
        status = $15, notes = $16
    WHERE id = $17
  `, [
    payload.assetTag || '',
    payload.barcode || '',
    payload.serialNumber || '',
    payload.description || '',
    payload.department || '',
    payload.assignedTo || '',
    toNumber(payload.purchaseCost),
    Math.max(0, toNumber(payload.stockQuantity, 1)),
    payload.purchaseDate || '',
    payload.brand || '',
    payload.model || '',
    payload.fiscalClass || 'processamento_dados',
    toNumber(payload.depreciationRate, 20),
    payload.supplierId || null,
    payload.status || 'em_uso',
    payload.notes || '',
    id,
  ], client);
  return getInventoryAsset(id, client);
}

async function deleteInventoryAsset(id, client) {
  await query('DELETE FROM inventory_assets WHERE id = $1', [id], client);
}

async function getFullState(client) {
  const [
    items,
    movements,
    priceHistory,
    extraPurchases,
    receipts,
    suppliers,
    cycle,
    settings,
    maintenanceAssets,
    maintenanceRecords,
    inventoryAssets,
  ] = await Promise.all([
    getAllItems(client),
    getAllMovements(client),
    getAllPrices(client),
    getAllExtras(client),
    getAllReceipts(client),
    getAllSuppliers(client),
    getCycle(client),
    getSettings(client),
    getAllAssets(client),
    getAllRecords(client),
    getAllInventoryAssets(client),
  ]);

  return {
    items,
    movements,
    priceHistory,
    extraPurchases,
    receipts,
    suppliers,
    cycle,
    settings,
    maintenanceAssets,
    maintenanceRecords,
    inventoryAssets,
  };
}

async function migrateFromLocalStorage(data) {
  return withTransaction(async (client) => {
    const itemCount = Number((await query('SELECT COUNT(*)::int AS total FROM items', [], client)).rows[0]?.total || 0);
    const supplierCount = Number((await query('SELECT COUNT(*)::int AS total FROM suppliers', [], client)).rows[0]?.total || 0);
    if (itemCount > 0 || supplierCount > 0) return { skipped: true, reason: 'DB already has data' };

    const supplierMap = new Map();
    const itemMap = new Map();

    for (const supplier of (data.suppliers || [])) {
      const inserted = await insertSupplier(supplier, client);
      supplierMap.set(supplier.id, inserted.id);
    }

    for (const item of (data.items || [])) {
      const inserted = await insertItem(item, client);
      itemMap.set(item.id, inserted.id);
    }

    for (const movement of (data.movements || [])) {
      await query(`
        INSERT INTO movements (type, "itemId", quantity, date, notes)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        movement.type,
        itemMap.get(movement.itemId) || movement.itemId,
        toNumber(movement.quantity),
        movement.date || '',
        movement.notes || '',
      ], client);
    }

    for (const price of (data.priceHistory || [])) {
      await insertPrice({
        ...price,
        itemId: itemMap.get(price.itemId) || price.itemId,
        supplierId: supplierMap.get(price.supplierId) || price.supplierId || null,
      }, client);
    }

    for (const extra of (data.extraPurchases || [])) {
      await insertExtra({
        ...extra,
        itemId: itemMap.get(extra.itemId) || extra.itemId,
        supplierId: supplierMap.get(extra.supplierId) || extra.supplierId || null,
      }, client);
    }

    for (const receipt of (data.receipts || [])) {
      let filePath = '';
      const dataUrl = receipt.fileDataUrl || receipt.dataUrl || '';
      if (dataUrl && dataUrl.startsWith('data:')) {
        try {
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const mime = match[1];
            const ext = mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
            const buffer = Buffer.from(match[2], 'base64');
            filePath = await uploadReceiptBuffer({
              buffer,
              fileName: receipt.fileName || `migrated.${ext}`,
              mimeType: mime,
              objectPath: `receipt/migrated-${receipt.id || Date.now()}-${Date.now()}.${ext}`,
            });
          }
        } catch { /* noop */ }
      }

      await insertReceipt({
        ...receipt,
        supplierId: supplierMap.get(receipt.supplierId) || receipt.supplierId || null,
      }, filePath, client);
    }

    if (data.cycle) {
      await updateCycle(data.cycle, client);
    }

    if (data.settings) {
      await updateSettings(data.settings, client);
    }

    return {
      ok: true,
      migrated: {
        suppliers: supplierMap.size,
        items: itemMap.size,
      },
    };
  });
}

async function insertReceiptAttachment(receiptId, file, client) {
  if (!receiptId || !file?.storedName) return null;

  const label = file.label
    || (file.mimeType?.includes('xml') ? 'XML complementar' : file.mimeType?.includes('pdf') ? 'PDF complementar' : 'Arquivo complementar');

  const { rows } = await query(`
    INSERT INTO receipt_files ("receiptId", kind, label, "fileName", "filePath", "mimeType")
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [
    receiptId,
    file.kind || 'attachment',
    label,
    file.originalName || file.fileName || '',
    file.storedName,
    file.mimeType || '',
  ], client);

  return normalizeReceiptFile(rows[0]);
}

async function getReceiptAttachment(receiptId, fileId, client) {
  const { rows } = await query('SELECT * FROM receipt_files WHERE id = $1 AND "receiptId" = $2', [fileId, receiptId], client);
  return normalizeReceiptFile(rows[0]);
}

async function batchImportReceipt(payload, primaryFile = null, extraFiles = []) {
  return withTransaction(async (client) => {
    const results = { newItems: [], movements: [], prices: [], receipt: null, attachments: [] };
    const receipt = await insertReceipt({
      title: payload.title || payload.fileName || 'Comprovante importado',
      value: toNumber(payload.totalValue),
      date: payload.date || new Date().toISOString().slice(0, 10),
      importedAt: new Date().toISOString(),
      notes: payload.notes || '',
      source: payload.source || 'entrada-ocr',
      supplierId: payload.supplierId || null,
      fileName: primaryFile?.originalName || payload.fileName || '',
      mimeType: primaryFile?.mimeType || payload.mimeType || '',
      accessKey: payload.accessKey || '',
      queryUrl: payload.queryUrl || '',
    }, primaryFile?.storedName || '', client);

    results.receipt = { id: receipt.id };

    for (const file of extraFiles) {
      const attachment = await insertReceiptAttachment(receipt.id, file, client);
      if (attachment) results.attachments.push(attachment);
    }

    for (const draft of (payload.items || [])) {
      if (!draft.import) continue;

      let itemId = draft.linkedItemId;
      if (!itemId) {
        const item = await insertItem({
          name: draft.name,
          unit: draft.unit || 'un',
          quantity: 0,
          minStock: 1,
          weeklyConsumption: 0,
          createdByReceiptId: receipt.id,
        }, client);
        itemId = item.id;
        results.newItems.push({ id: itemId, name: draft.name });
      }

      const { rows } = await query(`
        INSERT INTO movements (type, "itemId", quantity, date, notes, "receiptId")
        VALUES ('entrada', $1, $2, $3, $4, $5)
        RETURNING *
      `, [
        itemId,
        toNumber(draft.quantity),
        payload.date || new Date().toISOString().slice(0, 10),
        `Importado de ${payload.fileName || 'comprovante'}`,
        receipt.id,
      ], client);
      results.movements.push({ id: Number(rows[0].id), itemId });

      const item = await getItem(itemId, client);
      if (item) {
        await updateItemQty(itemId, toNumber(item.quantity) + toNumber(draft.quantity), client);
      }

      if (toNumber(draft.unitPrice) > 0 && payload.supplierId) {
        const price = await insertPrice({
          itemId,
          supplierId: Number(payload.supplierId),
          market: '',
          price: toNumber(draft.unitPrice),
          date: payload.date || new Date().toISOString().slice(0, 10),
          receiptId: receipt.id,
        }, client);
        results.prices.push({ id: price.id, itemId });
      }
    }

    return results;
  });
}

module.exports = {
  getAllItems,
  getItem,
  insertItem,
  updateItem,
  deleteItem,
  updateItemQty,
  updateItemConsumption,
  getAllMovements,
  insertMovement,
  getAllPrices,
  insertPrice,
  getAllExtras,
  insertExtra,
  getAllReceipts,
  getReceipt,
  getReceiptAttachment,
  insertReceipt,
  insertReceiptAttachment,
  deleteReceipt,
  getAllSuppliers,
  getSupplier,
  insertSupplier,
  updateSupplier,
  deleteSupplier,
  getCycle,
  updateCycle,
  getSettings,
  updateSettings,
  getFullState,
  migrateFromLocalStorage,
  batchImportReceipt,
  getAllAssets,
  getAsset,
  insertAsset,
  updateAsset,
  deleteAsset,
  getAllRecords,
  insertRecord,
  deleteRecord,
  getAllInventoryAssets,
  getInventoryAsset,
  insertInventoryAsset,
  updateInventoryAsset,
  deleteInventoryAsset,
  RECEIPTS_DIR,
};
