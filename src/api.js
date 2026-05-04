// API wrapper - usa backend local em desenvolvimento e mesma origem em producao/Vercel.
const API_BASE = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? (import.meta.env.VITE_NFCE_API_URL || 'http://127.0.0.1:3333').replace(/\/$/, '')
  : (import.meta.env.VITE_NFCE_API_URL || '').replace(/\/$/, '');

const json = (method, path, body) =>
  fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  }).then((r) => {
    if (!r.ok) return r.json().then((e) => Promise.reject(e));
    return r.json();
  });

const api = {
  getState: () => json('GET', '/api/state'),
  migrate: (data) => json('POST', '/api/migrate', data),

  addItem: (p) => json('POST', '/api/items', p),
  updateItem: (id, p) => json('PUT', `/api/items/${id}`, p),
  deleteItem: (id) => json('DELETE', `/api/items/${id}`),
  updateConsumption: (id, wc) => json('PATCH', `/api/items/${id}/consumption`, { weeklyConsumption: wc }),

  registerMovement: (p) => json('POST', '/api/movements', p),
  addPrice: (p) => json('POST', '/api/prices', p),
  registerExtra: (p) => json('POST', '/api/extras', p),

  addReceipt: (data, file) => {
    const fd = new FormData();
    fd.append('data', JSON.stringify(data));
    if (file) fd.append('file', file);
    return fetch(`${API_BASE}/api/receipts`, { method: 'POST', body: fd }).then((r) => r.json());
  },
  deleteReceipt: (id, mode = 'receipt-only') => json('DELETE', `/api/receipts/${id}?mode=${encodeURIComponent(mode)}`),
  receiptFileUrl: (id) => `${API_BASE}/api/receipts/${id}/file`,
  receiptAttachmentUrl: (receiptId, fileId) => `${API_BASE}/api/receipts/${receiptId}/files/${fileId}`,

  addSupplier: (p) => json('POST', '/api/suppliers', p),
  updateSupplier: (id, p) => json('PUT', `/api/suppliers/${id}`, p),
  deleteSupplier: (id) => json('DELETE', `/api/suppliers/${id}`),

  updateCycle: (p) => json('PUT', '/api/cycle', p),
  saveSettings: (p) => json('PUT', '/api/settings', p),

  importReceipt: (data, file) => {
    const fd = new FormData();
    fd.append('data', JSON.stringify(data));
    if (file) fd.append('file', file);
    return fetch(`${API_BASE}/api/import-receipt`, { method: 'POST', body: fd }).then((r) => r.json());
  },

  addMaintenanceAsset: (p) => json('POST', '/api/maintenance/assets', p),
  updateMaintenanceAsset: (id, p) => json('PUT', `/api/maintenance/assets/${id}`, p),
  deleteMaintenanceAsset: (id) => json('DELETE', `/api/maintenance/assets/${id}`),
  addMaintenanceRecord: (p) => json('POST', '/api/maintenance/records', p),
  deleteMaintenanceRecord: (id) => json('DELETE', `/api/maintenance/records/${id}`),

  addInventoryAsset: (p) => json('POST', '/api/inventory/assets', p),
  updateInventoryAsset: (id, p) => json('PUT', `/api/inventory/assets/${id}`, p),
  deleteInventoryAsset: (id) => json('DELETE', `/api/inventory/assets/${id}`),
};

export default api;
