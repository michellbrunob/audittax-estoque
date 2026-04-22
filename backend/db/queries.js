const { db, RECEIPTS_DIR } = require('./database.js');
const fs = require('fs');
const path = require('path');

// ─── Helpers ───
const bool = (v) => (v ? 1 : 0);
const unbool = (v) => v === 1;

// ─── Items ───
const stmtAllItems = db.prepare('SELECT * FROM items ORDER BY name');
const stmtGetItem = db.prepare('SELECT * FROM items WHERE id = ?');
const stmtInsertItem = db.prepare('INSERT INTO items (name, unit, quantity, minStock, weeklyConsumption, createdByReceiptId) VALUES (@name, @unit, @quantity, @minStock, @weeklyConsumption, @createdByReceiptId)');
const stmtUpdateItem = db.prepare('UPDATE items SET name=@name, unit=@unit, quantity=@quantity, minStock=@minStock, weeklyConsumption=@weeklyConsumption WHERE id=@id');
const stmtDeleteItem = db.prepare('DELETE FROM items WHERE id = ?');
const stmtUpdateItemQty = db.prepare('UPDATE items SET quantity = @quantity WHERE id = @id');
const stmtUpdateItemConsumption = db.prepare('UPDATE items SET weeklyConsumption = @weeklyConsumption WHERE id = @id');

const getAllItems = () => stmtAllItems.all();
const getItem = (id) => stmtGetItem.get(id);
const insertItem = (p) => {
  const r = stmtInsertItem.run({
    name: p.name || '',
    unit: p.unit || 'un',
    quantity: Number(p.quantity || 0),
    minStock: Number(p.minStock || 0),
    weeklyConsumption: Number(p.weeklyConsumption || 0),
    createdByReceiptId: p.createdByReceiptId || null,
  });
  return {
    id: Number(r.lastInsertRowid),
    name: p.name || '',
    unit: p.unit || 'un',
    quantity: Number(p.quantity || 0),
    minStock: Number(p.minStock || 0),
    weeklyConsumption: Number(p.weeklyConsumption || 0),
    createdByReceiptId: p.createdByReceiptId || null,
  };
};
const updateItem = (id, p) => {
  stmtUpdateItem.run({ id, name: p.name, unit: p.unit, quantity: Number(p.quantity || 0), minStock: Number(p.minStock || 0), weeklyConsumption: Number(p.weeklyConsumption || 0) });
  return getItem(id);
};
const deleteItem = (id) => stmtDeleteItem.run(id);
const updateItemQty = (id, qty) => stmtUpdateItemQty.run({ id, quantity: qty });
const updateItemConsumption = (id, wc) => stmtUpdateItemConsumption.run({ id, weeklyConsumption: wc });

// ─── Movements ───
const stmtAllMovements = db.prepare('SELECT * FROM movements ORDER BY date DESC, id DESC');
const stmtInsertMovement = db.prepare('INSERT INTO movements (type, itemId, quantity, date, notes, receiptId) VALUES (@type, @itemId, @quantity, @date, @notes, @receiptId)');

const getAllMovements = () => stmtAllMovements.all();
const insertMovement = (p) => {
  const r = stmtInsertMovement.run({
    type: p.type,
    itemId: p.itemId,
    quantity: Number(p.quantity),
    date: p.date || new Date().toISOString().slice(0, 10),
    notes: p.notes || '',
    receiptId: p.receiptId || null,
  });
  const item = getItem(p.itemId);
  if (item) {
    let newQty = item.quantity;
    if (p.type === 'entrada') newQty += Number(p.quantity);
    else if (p.type === 'saida') newQty = Math.max(0, newQty - Number(p.quantity));
    else if (p.type === 'avulso') newQty += Number(p.quantity);
    updateItemQty(p.itemId, newQty);
  }
  return {
    id: Number(r.lastInsertRowid),
    type: p.type,
    itemId: p.itemId,
    quantity: Number(p.quantity),
    date: p.date || new Date().toISOString().slice(0, 10),
    notes: p.notes || '',
    receiptId: p.receiptId || null,
  };
};

// ─── Price History ───
const stmtAllPrices = db.prepare('SELECT * FROM price_history ORDER BY date DESC, id DESC');
const stmtInsertPrice = db.prepare('INSERT INTO price_history (itemId, supplierId, market, price, date, receiptId) VALUES (@itemId, @supplierId, @market, @price, @date, @receiptId)');

const getAllPrices = () => stmtAllPrices.all();
const insertPrice = (p) => {
  const r = stmtInsertPrice.run({
    itemId: p.itemId,
    supplierId: p.supplierId || null,
    market: p.market || '',
    price: Number(p.price),
    date: p.date || new Date().toISOString().slice(0, 10),
    receiptId: p.receiptId || null,
  });
  return {
    id: Number(r.lastInsertRowid),
    itemId: p.itemId,
    supplierId: p.supplierId || null,
    market: p.market || '',
    price: Number(p.price),
    date: p.date || new Date().toISOString().slice(0, 10),
    receiptId: p.receiptId || null,
  };
};

// ─── Extra Purchases ───
const stmtAllExtras = db.prepare('SELECT * FROM extra_purchases ORDER BY date DESC, id DESC');
const stmtInsertExtra = db.prepare('INSERT INTO extra_purchases (itemId, quantity, date, cost, reason, supplierId, location) VALUES (@itemId, @quantity, @date, @cost, @reason, @supplierId, @location)');

const getAllExtras = () => stmtAllExtras.all();
const insertExtra = (p) => {
  const r = stmtInsertExtra.run({ itemId: p.itemId, quantity: Number(p.quantity), date: p.date || new Date().toISOString().slice(0, 10), cost: Number(p.cost || 0), reason: p.reason || '', supplierId: p.supplierId || null, location: p.location || '' });
  return { id: Number(r.lastInsertRowid), ...p };
};

// ─── Receipts ───
const stmtAllReceipts = db.prepare('SELECT * FROM receipts ORDER BY date DESC, id DESC');
const stmtGetReceipt = db.prepare('SELECT * FROM receipts WHERE id = ?');
const stmtInsertReceipt = db.prepare('INSERT INTO receipts (title, value, date, importedAt, notes, source, supplierId, fileName, filePath, mimeType, accessKey, queryUrl) VALUES (@title, @value, @date, @importedAt, @notes, @source, @supplierId, @fileName, @filePath, @mimeType, @accessKey, @queryUrl)');
const stmtDeleteReceipt = db.prepare('DELETE FROM receipts WHERE id = ?');
const stmtReceiptFilesByReceipt = db.prepare('SELECT * FROM receipt_files WHERE receiptId = ? ORDER BY id');
const stmtReceiptFileById = db.prepare('SELECT * FROM receipt_files WHERE id = ? AND receiptId = ?');
const stmtInsertReceiptFile = db.prepare('INSERT INTO receipt_files (receiptId, kind, label, fileName, filePath, mimeType) VALUES (@receiptId, @kind, @label, @fileName, @filePath, @mimeType)');
const stmtCountReceiptMovements = db.prepare('SELECT COUNT(*) AS total FROM movements WHERE receiptId = ?');
const stmtCountReceiptPrices = db.prepare('SELECT COUNT(*) AS total FROM price_history WHERE receiptId = ?');
const stmtCountReceiptCreatedItems = db.prepare('SELECT COUNT(*) AS total FROM items WHERE createdByReceiptId = ?');
const stmtListReceiptMovements = db.prepare('SELECT id, type, itemId, quantity FROM movements WHERE receiptId = ? ORDER BY id');
const stmtListReceiptPrices = db.prepare('SELECT id, itemId FROM price_history WHERE receiptId = ? ORDER BY id');
const stmtListReceiptCreatedItems = db.prepare('SELECT id, name, quantity FROM items WHERE createdByReceiptId = ? ORDER BY id');
const stmtDeleteReceiptMovements = db.prepare('DELETE FROM movements WHERE receiptId = ?');
const stmtDeleteReceiptPrices = db.prepare('DELETE FROM price_history WHERE receiptId = ?');
const stmtDeleteReceiptCreatedItems = db.prepare('DELETE FROM items WHERE createdByReceiptId = ?');
const stmtCountExternalItemReferences = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM movements WHERE itemId = @itemId AND (receiptId IS NULL OR receiptId != @receiptId)) +
    (SELECT COUNT(*) FROM price_history WHERE itemId = @itemId AND (receiptId IS NULL OR receiptId != @receiptId)) +
    (SELECT COUNT(*) FROM extra_purchases WHERE itemId = @itemId) AS total
`);

function getReceiptImportSummary(receiptId) {
  const movementCount = stmtCountReceiptMovements.get(receiptId)?.total || 0;
  const priceCount = stmtCountReceiptPrices.get(receiptId)?.total || 0;
  const createdItemCount = stmtCountReceiptCreatedItems.get(receiptId)?.total || 0;

  return {
    movementCount,
    priceCount,
    createdItemCount,
    canRevertImport: movementCount > 0 || priceCount > 0 || createdItemCount > 0,
  };
}

function hydrateReceipt(receipt) {
  if (!receipt) {
    return null;
  }

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

  stmtReceiptFilesByReceipt.all(receipt.id).forEach((file) => {
    attachments.push({
      ...file,
      isPrimary: false,
    });
  });

  return {
    ...receipt,
    hasFile: Boolean(receipt.filePath),
    attachments,
    importSummary: getReceiptImportSummary(receipt.id),
  };
}

const getAllReceipts = () => stmtAllReceipts.all().map(hydrateReceipt);
const getReceipt = (id) => hydrateReceipt(stmtGetReceipt.get(id));
const insertReceipt = (p, filePath = '') => {
  const r = stmtInsertReceipt.run({
    title: p.title || '', value: Number(p.value || 0), date: p.date || new Date().toISOString().slice(0, 10),
    importedAt: p.importedAt || new Date().toISOString(), notes: p.notes || '', source: p.source || '',
    supplierId: p.supplierId || null, fileName: p.fileName || '', filePath: filePath || '',
    mimeType: p.mimeType || '', accessKey: p.accessKey || '', queryUrl: p.queryUrl || ''
  });
  return { id: Number(r.lastInsertRowid), ...p, filePath };
};
function deleteReceiptFile(receipt) {
  if (receipt?.filePath) {
    const fullPath = path.join(RECEIPTS_DIR, receipt.filePath);
    try { fs.unlinkSync(fullPath); } catch { /* ok */ }
  }
}

function deleteAttachmentFiles(receiptId) {
  stmtReceiptFilesByReceipt.all(receiptId).forEach((file) => {
    if (!file?.filePath) return;
    const fullPath = path.join(RECEIPTS_DIR, file.filePath);
    try { fs.unlinkSync(fullPath); } catch { /* ok */ }
  });
}

function movementImpact(type, quantity) {
  const amount = Number(quantity || 0);
  if (type === 'saida') return -amount;
  return amount;
}

const deleteReceipt = (id, mode = 'receipt-only') => {
  const runDelete = db.transaction(() => {
    const receipt = getReceipt(id);
    if (!receipt) {
      return { ok: true, mode, deletedReceiptId: id, importSummary: getReceiptImportSummary(id) };
    }

    if (mode === 'revert-import') {
      const linkedMovements = stmtListReceiptMovements.all(id);
      const linkedCreatedItems = stmtListReceiptCreatedItems.all(id);
      const stockAdjustments = new Map();

      linkedMovements.forEach((movement) => {
        const current = stockAdjustments.get(movement.itemId) || 0;
        stockAdjustments.set(movement.itemId, current + movementImpact(movement.type, movement.quantity));
      });

      for (const [itemId, importedDelta] of stockAdjustments.entries()) {
        const item = getItem(itemId);
        if (!item) continue;
        const nextQty = Number(item.quantity || 0) - importedDelta;
        if (nextQty < 0) {
          throw new Error(`Nao foi possivel reverter a importacao do item "${item.name}". O estoque atual ja foi consumido parcialmente.`);
        }
      }

      for (const [itemId, importedDelta] of stockAdjustments.entries()) {
        const item = getItem(itemId);
        if (!item) continue;
        updateItemQty(itemId, Number((Number(item.quantity || 0) - importedDelta).toFixed(4)));
      }

      stmtDeleteReceiptMovements.run(id);
      stmtDeleteReceiptPrices.run(id);

      linkedCreatedItems.forEach((item) => {
        const refs = stmtCountExternalItemReferences.get({ itemId: item.id, receiptId: id });
        if ((refs?.total || 0) === 0) {
          stmtDeleteItem.run(item.id);
        }
      });
    }

    deleteAttachmentFiles(id);
    deleteReceiptFile(receipt);
    stmtDeleteReceipt.run(id);

    return {
      ok: true,
      mode,
      deletedReceiptId: id,
      importSummary: receipt.importSummary || getReceiptImportSummary(id),
    };
  });

  return runDelete();
};

// ─── Suppliers ───
const stmtAllSuppliers = db.prepare('SELECT * FROM suppliers ORDER BY name');
const stmtGetSupplier = db.prepare('SELECT * FROM suppliers WHERE id = ?');
const stmtInsertSupplier = db.prepare('INSERT INTO suppliers (name, tradeName, type, city, state, cnpj, notes, active) VALUES (@name, @tradeName, @type, @city, @state, @cnpj, @notes, @active)');
const stmtUpdateSupplier = db.prepare('UPDATE suppliers SET name=@name, tradeName=@tradeName, type=@type, city=@city, state=@state, cnpj=@cnpj, notes=@notes, active=@active WHERE id=@id');
const stmtDeleteSupplier = db.prepare('DELETE FROM suppliers WHERE id = ?');
const stmtSupplierRefCount = db.prepare('SELECT (SELECT COUNT(*) FROM price_history WHERE supplierId=?) + (SELECT COUNT(*) FROM extra_purchases WHERE supplierId=?) + (SELECT COUNT(*) FROM receipts WHERE supplierId=?) AS total');

const getAllSuppliers = () => stmtAllSuppliers.all().map((s) => ({ ...s, active: unbool(s.active) }));
const getSupplier = (id) => { const s = stmtGetSupplier.get(id); return s ? { ...s, active: unbool(s.active) } : null; };
const insertSupplier = (p) => {
  const r = stmtInsertSupplier.run({ name: p.name || '', tradeName: p.tradeName || '', type: p.type || '', city: p.city || '', state: p.state || '', cnpj: p.cnpj || '', notes: p.notes || '', active: bool(p.active !== false) });
  return { id: Number(r.lastInsertRowid), name: p.name || '', tradeName: p.tradeName || '', type: p.type || '', city: p.city || '', state: p.state || '', cnpj: p.cnpj || '', notes: p.notes || '', active: p.active !== false };
};
const updateSupplier = (id, p) => {
  stmtUpdateSupplier.run({ id, name: p.name || '', tradeName: p.tradeName || '', type: p.type || '', city: p.city || '', state: p.state || '', cnpj: p.cnpj || '', notes: p.notes || '', active: bool(p.active !== false) });
  return getSupplier(id);
};
const deleteSupplier = (id) => {
  const refs = stmtSupplierRefCount.get(id, id, id);
  if (refs && refs.total > 0) return { error: 'Fornecedor tem registros vinculados', refs: refs.total };
  stmtDeleteSupplier.run(id);
  return { ok: true };
};

// ─── Cycle ───
const stmtGetCycle = db.prepare('SELECT * FROM cycle WHERE id = 1');
const stmtUpdateCycle = db.prepare('UPDATE cycle SET lastPurchaseDate=@lastPurchaseDate, intervalDays=@intervalDays WHERE id=1');

const getCycle = () => { const c = stmtGetCycle.get(); return c ? { lastPurchaseDate: c.lastPurchaseDate, intervalDays: c.intervalDays } : { lastPurchaseDate: '', intervalDays: 60 }; };
const updateCycleQ = (p) => { stmtUpdateCycle.run({ lastPurchaseDate: p.lastPurchaseDate || '', intervalDays: Number(p.intervalDays || 60) }); return getCycle(); };

// ─── Settings ───
const stmtGetSettings = db.prepare('SELECT * FROM settings WHERE id = 1');
const stmtUpdateSettings = db.prepare('UPDATE settings SET anthropicApiKey=@anthropicApiKey WHERE id=1');

const getSettings = () => { const s = stmtGetSettings.get(); return s ? { anthropicApiKey: s.anthropicApiKey || '' } : { anthropicApiKey: '' }; };
const updateSettingsQ = (p) => { stmtUpdateSettings.run({ anthropicApiKey: p.anthropicApiKey || '' }); return getSettings(); };

// ─── Maintenance Assets ───
const stmtAllAssets = db.prepare('SELECT * FROM maintenance_assets ORDER BY name');
const stmtGetAsset = db.prepare('SELECT * FROM maintenance_assets WHERE id = ?');
const stmtInsertAsset = db.prepare('INSERT INTO maintenance_assets (category,name,location,brand,model,serialNumber,supplierId,supplierName,intervalDays,lastMaintenanceDate,notes,btuCapacity,acType,inkColors,poolVolume,areaM2,filterIntervalDays,herbicideIntervalDays,lastHerbicideDate,active) VALUES (@category,@name,@location,@brand,@model,@serialNumber,@supplierId,@supplierName,@intervalDays,@lastMaintenanceDate,@notes,@btuCapacity,@acType,@inkColors,@poolVolume,@areaM2,@filterIntervalDays,@herbicideIntervalDays,@lastHerbicideDate,@active)');
const stmtUpdateAsset = db.prepare('UPDATE maintenance_assets SET category=@category,name=@name,location=@location,brand=@brand,model=@model,serialNumber=@serialNumber,supplierId=@supplierId,supplierName=@supplierName,intervalDays=@intervalDays,lastMaintenanceDate=@lastMaintenanceDate,notes=@notes,btuCapacity=@btuCapacity,acType=@acType,inkColors=@inkColors,poolVolume=@poolVolume,areaM2=@areaM2,filterIntervalDays=@filterIntervalDays,herbicideIntervalDays=@herbicideIntervalDays,lastHerbicideDate=@lastHerbicideDate,active=@active WHERE id=@id');
const stmtDeleteAsset = db.prepare('DELETE FROM maintenance_assets WHERE id = ?');
const stmtUpdateAssetLastDate = db.prepare('UPDATE maintenance_assets SET lastMaintenanceDate=@date WHERE id=@id');
const stmtUpdateAssetHerbicideDate = db.prepare('UPDATE maintenance_assets SET lastHerbicideDate=@date WHERE id=@id');

const getAllAssets = () => stmtAllAssets.all().map((a) => ({ ...a, active: unbool(a.active) }));
const getAsset = (id) => { const a = stmtGetAsset.get(id); return a ? { ...a, active: unbool(a.active) } : null; };
const insertAsset = (p) => {
  const r = stmtInsertAsset.run({ category: p.category||'outro', name: p.name||'', location: p.location||'', brand: p.brand||'', model: p.model||'', serialNumber: p.serialNumber||'', supplierId: p.supplierId||null, supplierName: p.supplierName||'', intervalDays: Number(p.intervalDays||180), lastMaintenanceDate: p.lastMaintenanceDate||'', notes: p.notes||'', btuCapacity: p.btuCapacity||'', acType: p.acType||'', inkColors: p.inkColors||'', poolVolume: p.poolVolume||'', areaM2: p.areaM2||'', filterIntervalDays: Number(p.filterIntervalDays||180), herbicideIntervalDays: Number(p.herbicideIntervalDays||30), lastHerbicideDate: p.lastHerbicideDate||'', active: bool(p.active!==false) });
  return getAsset(Number(r.lastInsertRowid));
};
const updateAsset = (id, p) => {
  stmtUpdateAsset.run({ id, category: p.category||'outro', name: p.name||'', location: p.location||'', brand: p.brand||'', model: p.model||'', serialNumber: p.serialNumber||'', supplierId: p.supplierId||null, supplierName: p.supplierName||'', intervalDays: Number(p.intervalDays||180), lastMaintenanceDate: p.lastMaintenanceDate||'', notes: p.notes||'', btuCapacity: p.btuCapacity||'', acType: p.acType||'', inkColors: p.inkColors||'', poolVolume: p.poolVolume||'', areaM2: p.areaM2||'', filterIntervalDays: Number(p.filterIntervalDays||180), herbicideIntervalDays: Number(p.herbicideIntervalDays||30), lastHerbicideDate: p.lastHerbicideDate||'', active: bool(p.active!==false) });
  return getAsset(id);
};
const deleteAsset = (id) => stmtDeleteAsset.run(id);

// ─── Maintenance Records ───
const stmtAllRecords = db.prepare('SELECT * FROM maintenance_records ORDER BY date DESC, id DESC');
const stmtInsertRecord = db.prepare('INSERT INTO maintenance_records (assetId,date,type,description,cost,technician,supplierId,notes,herbicideProduct,herbicideQuantity,nextApplicationDate) VALUES (@assetId,@date,@type,@description,@cost,@technician,@supplierId,@notes,@herbicideProduct,@herbicideQuantity,@nextApplicationDate)');
const stmtDeleteRecord = db.prepare('DELETE FROM maintenance_records WHERE id = ?');

const getAllRecords = () => stmtAllRecords.all();
const insertRecord = (p) => {
  const date = p.date || new Date().toISOString().slice(0,10);
  const type = p.type || 'preventiva';
  const payload = { assetId: Number(p.assetId), date, type, description: p.description||'', cost: Number(p.cost||0), technician: p.technician||'', supplierId: p.supplierId||null, notes: p.notes||'', herbicideProduct: p.herbicideProduct||'', herbicideQuantity: p.herbicideQuantity||'', nextApplicationDate: p.nextApplicationDate||'' };
  const r = stmtInsertRecord.run(payload);
  if (type === 'aplicacao_herbicida') {
    stmtUpdateAssetHerbicideDate.run({ id: Number(p.assetId), date });
  } else {
    stmtUpdateAssetLastDate.run({ id: Number(p.assetId), date });
  }
  return { id: Number(r.lastInsertRowid), ...payload };
};
const deleteRecord = (id) => stmtDeleteRecord.run(id);

// ─── IT Inventory Assets ───
const stmtAllInventoryAssets = db.prepare('SELECT * FROM inventory_assets ORDER BY description, assetTag');
const stmtGetInventoryAsset = db.prepare('SELECT * FROM inventory_assets WHERE id = ?');
const stmtInsertInventoryAsset = db.prepare('INSERT INTO inventory_assets (assetTag,barcode,serialNumber,description,department,assignedTo,purchaseCost,stockQuantity,purchaseDate,brand,model,fiscalClass,depreciationRate,supplierId,status,notes) VALUES (@assetTag,@barcode,@serialNumber,@description,@department,@assignedTo,@purchaseCost,@stockQuantity,@purchaseDate,@brand,@model,@fiscalClass,@depreciationRate,@supplierId,@status,@notes)');
const stmtUpdateInventoryAsset = db.prepare('UPDATE inventory_assets SET assetTag=@assetTag,barcode=@barcode,serialNumber=@serialNumber,description=@description,department=@department,assignedTo=@assignedTo,purchaseCost=@purchaseCost,stockQuantity=@stockQuantity,purchaseDate=@purchaseDate,brand=@brand,model=@model,fiscalClass=@fiscalClass,depreciationRate=@depreciationRate,supplierId=@supplierId,status=@status,notes=@notes WHERE id=@id');
const stmtDeleteInventoryAsset = db.prepare('DELETE FROM inventory_assets WHERE id = ?');

const getAllInventoryAssets = () => stmtAllInventoryAssets.all();
const getInventoryAsset = (id) => stmtGetInventoryAsset.get(id);
const insertInventoryAsset = (p) => {
  const r = stmtInsertInventoryAsset.run({
    assetTag: p.assetTag || '',
    barcode: p.barcode || '',
    serialNumber: p.serialNumber || '',
    description: p.description || '',
    department: p.department || '',
    assignedTo: p.assignedTo || '',
    purchaseCost: Number(p.purchaseCost || 0),
    stockQuantity: Math.max(0, Number(p.stockQuantity || 1)),
    purchaseDate: p.purchaseDate || '',
    brand: p.brand || '',
    model: p.model || '',
    fiscalClass: p.fiscalClass || 'processamento_dados',
    depreciationRate: Number(p.depreciationRate || 20),
    supplierId: p.supplierId || null,
    status: p.status || 'em_uso',
    notes: p.notes || '',
  });
  return getInventoryAsset(Number(r.lastInsertRowid));
};
const updateInventoryAsset = (id, p) => {
  stmtUpdateInventoryAsset.run({
    id,
    assetTag: p.assetTag || '',
    barcode: p.barcode || '',
    serialNumber: p.serialNumber || '',
    description: p.description || '',
    department: p.department || '',
    assignedTo: p.assignedTo || '',
    purchaseCost: Number(p.purchaseCost || 0),
    stockQuantity: Math.max(0, Number(p.stockQuantity || 1)),
    purchaseDate: p.purchaseDate || '',
    brand: p.brand || '',
    model: p.model || '',
    fiscalClass: p.fiscalClass || 'processamento_dados',
    depreciationRate: Number(p.depreciationRate || 20),
    supplierId: p.supplierId || null,
    status: p.status || 'em_uso',
    notes: p.notes || '',
  });
  return getInventoryAsset(id);
};
const deleteInventoryAsset = (id) => stmtDeleteInventoryAsset.run(id);

// ─── Full State ───
const getFullState = () => ({
  items: getAllItems(),
  movements: getAllMovements(),
  priceHistory: getAllPrices(),
  extraPurchases: getAllExtras(),
  receipts: getAllReceipts(),
  suppliers: getAllSuppliers(),
  cycle: getCycle(),
  settings: getSettings(),
  maintenanceAssets: getAllAssets(),
  maintenanceRecords: getAllRecords(),
  inventoryAssets: getAllInventoryAssets(),
});

// ─── Migração do localStorage ───
const migrateFromLocalStorage = (data) => {
  const migrate = db.transaction(() => {
    const itemCount = db.prepare('SELECT COUNT(*) as n FROM items').get().n;
    const supplierCount = db.prepare('SELECT COUNT(*) as n FROM suppliers').get().n;
    if (itemCount > 0 || supplierCount > 0) return { skipped: true, reason: 'DB already has data' };

    const idMapSuppliers = {};
    const idMapItems = {};

    for (const s of (data.suppliers || [])) {
      const r = db.prepare('INSERT INTO suppliers (name, tradeName, type, city, state, cnpj, notes, active) VALUES (?,?,?,?,?,?,?,?)').run(
        s.name || '', s.tradeName || '', s.type || '', s.city || '', s.state || '', s.cnpj || '', s.notes || '', bool(s.active !== false)
      );
      idMapSuppliers[s.id] = Number(r.lastInsertRowid);
    }

    for (const item of (data.items || [])) {
      const r = db.prepare('INSERT INTO items (name, unit, quantity, minStock, weeklyConsumption) VALUES (?,?,?,?,?)').run(
        item.name, item.unit || 'un', Number(item.quantity || 0), Number(item.minStock || 0), Number(item.weeklyConsumption || 0)
      );
      idMapItems[item.id] = Number(r.lastInsertRowid);
    }

    for (const m of (data.movements || [])) {
      const newItemId = idMapItems[m.itemId] || m.itemId;
      db.prepare('INSERT INTO movements (type, itemId, quantity, date, notes) VALUES (?,?,?,?,?)').run(
        m.type, newItemId, Number(m.quantity), m.date || '', m.notes || ''
      );
    }

    for (const p of (data.priceHistory || [])) {
      const newItemId = idMapItems[p.itemId] || p.itemId;
      const newSuppId = idMapSuppliers[p.supplierId] || p.supplierId || null;
      db.prepare('INSERT INTO price_history (itemId, supplierId, market, price, date) VALUES (?,?,?,?,?)').run(
        newItemId, newSuppId, p.market || '', Number(p.price), p.date || ''
      );
    }

    for (const e of (data.extraPurchases || [])) {
      const newItemId = idMapItems[e.itemId] || e.itemId;
      const newSuppId = idMapSuppliers[e.supplierId] || e.supplierId || null;
      db.prepare('INSERT INTO extra_purchases (itemId, quantity, date, cost, reason, supplierId, location) VALUES (?,?,?,?,?,?,?)').run(
        newItemId, Number(e.quantity), e.date || '', Number(e.cost || 0), e.reason || '', newSuppId, e.location || ''
      );
    }

    for (const r of (data.receipts || [])) {
      let filePath = '';
      const dataUrl = r.fileDataUrl || r.dataUrl || '';
      if (dataUrl && dataUrl.startsWith('data:')) {
        try {
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const mime = match[1];
            const ext = mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
            const buffer = Buffer.from(match[2], 'base64');
            const fileName = `migrated-${r.id || Date.now()}-${Date.now()}.${ext}`;
            fs.writeFileSync(path.join(RECEIPTS_DIR, fileName), buffer);
            filePath = fileName;
          }
        } catch { /* skip */ }
      }
      const newSuppId = idMapSuppliers[r.supplierId] || r.supplierId || null;
      db.prepare('INSERT INTO receipts (title, value, date, importedAt, notes, source, supplierId, fileName, filePath, mimeType, accessKey, queryUrl) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
        r.title || '', Number(r.value || 0), r.date || '', r.importedAt || '', r.notes || '',
        r.source || '', newSuppId, r.fileName || '', filePath, r.mimeType || '', r.accessKey || '', r.queryUrl || ''
      );
    }

    if (data.cycle) {
      db.prepare('UPDATE cycle SET lastPurchaseDate=?, intervalDays=? WHERE id=1').run(
        data.cycle.lastPurchaseDate || '', Number(data.cycle.intervalDays || 60)
      );
    }

    if (data.settings) {
      db.prepare('UPDATE settings SET anthropicApiKey=? WHERE id=1').run(data.settings.anthropicApiKey || '');
    }

    return { ok: true, migrated: { suppliers: Object.keys(idMapSuppliers).length, items: Object.keys(idMapItems).length } };
  });

  return migrate();
};

// ─── Batch Import ───
const insertReceiptAttachment = (receiptId, file) => {
  if (!receiptId || !file?.storedName) {
    return null;
  }

  const label = file.label
    || (file.mimeType?.includes('xml') ? 'XML complementar' : file.mimeType?.includes('pdf') ? 'PDF complementar' : 'Arquivo complementar');

  const result = stmtInsertReceiptFile.run({
    receiptId,
    kind: file.kind || 'attachment',
    label,
    fileName: file.originalName || file.fileName || '',
    filePath: file.storedName,
    mimeType: file.mimeType || '',
  });

  return { id: Number(result.lastInsertRowid), receiptId, label, fileName: file.originalName || file.fileName || '', filePath: file.storedName, mimeType: file.mimeType || '' };
};

const getReceiptAttachment = (receiptId, fileId) => stmtReceiptFileById.get(fileId, receiptId);

const batchImportReceipt = (payload, primaryFile = null, extraFiles = []) => {
  const batch = db.transaction(() => {
    const results = { newItems: [], movements: [], prices: [], receipt: null, attachments: [] };
    const receiptResult = stmtInsertReceipt.run({
      title: payload.title || payload.fileName || 'Comprovante importado',
      value: Number(payload.totalValue || 0), date: payload.date || new Date().toISOString().slice(0, 10),
      importedAt: new Date().toISOString(), notes: payload.notes || '', source: payload.source || 'entrada-ocr',
      supplierId: payload.supplierId || null,
      fileName: primaryFile?.originalName || payload.fileName || '',
      filePath: primaryFile?.storedName || '',
      mimeType: primaryFile?.mimeType || payload.mimeType || '',
      accessKey: payload.accessKey || '', queryUrl: payload.queryUrl || ''
    });
    const receiptId = Number(receiptResult.lastInsertRowid);
    results.receipt = { id: receiptId };
    results.attachments = extraFiles.map((file) => insertReceiptAttachment(receiptId, file)).filter(Boolean);

    for (const draft of (payload.items || [])) {
      if (!draft.import) continue;
      let itemId = draft.linkedItemId;
      if (!itemId) {
        const r = stmtInsertItem.run({
          name: draft.name,
          unit: draft.unit || 'un',
          quantity: 0,
          minStock: 1,
          weeklyConsumption: 0,
          createdByReceiptId: receiptId,
        });
        itemId = Number(r.lastInsertRowid);
        results.newItems.push({ id: itemId, name: draft.name });
      }

      const mR = stmtInsertMovement.run({
        type: 'entrada',
        itemId,
        quantity: Number(draft.quantity || 0),
        date: payload.date || new Date().toISOString().slice(0, 10),
        notes: `Importado de ${payload.fileName || 'comprovante'}`,
        receiptId,
      });
      results.movements.push({ id: Number(mR.lastInsertRowid), itemId });

      const item = getItem(itemId);
      if (item) updateItemQty(itemId, item.quantity + Number(draft.quantity || 0));

      if (draft.unitPrice > 0 && payload.supplierId) {
        const pR = stmtInsertPrice.run({
          itemId,
          supplierId: Number(payload.supplierId),
          market: '',
          price: Number(draft.unitPrice),
          date: payload.date || new Date().toISOString().slice(0, 10),
          receiptId,
        });
        results.prices.push({ id: Number(pR.lastInsertRowid), itemId });
      }
    }

    return results;
  });

  return batch();
};

module.exports = {
  getAllItems, getItem, insertItem, updateItem, deleteItem, updateItemQty, updateItemConsumption,
  getAllMovements, insertMovement,
  getAllPrices, insertPrice,
  getAllExtras, insertExtra,
  getAllReceipts, getReceipt, getReceiptAttachment, insertReceipt, insertReceiptAttachment, deleteReceipt,
  getAllSuppliers, getSupplier, insertSupplier, updateSupplier, deleteSupplier,
  getCycle, updateCycle: updateCycleQ,
  getSettings, updateSettings: updateSettingsQ,
  getFullState, migrateFromLocalStorage, batchImportReceipt,
  getAllAssets, getAsset, insertAsset, updateAsset, deleteAsset,
  getAllRecords, insertRecord, deleteRecord,
  getAllInventoryAssets, getInventoryAsset, insertInventoryAsset, updateInventoryAsset, deleteInventoryAsset,
  RECEIPTS_DIR,
};
