require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const STORAGE_DIR = __dirname;
const RECEIPTS_DIR = path.join(STORAGE_DIR, 'receipts');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RECEIPTS_BUCKET = process.env.SUPABASE_RECEIPTS_BUCKET || 'receipts';

const canWriteLocalStorage = process.env.VERCEL !== '1';
if (canWriteLocalStorage) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

const storageEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase = storageEnabled
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

function ensureStorageEnabled() {
  if (!storageEnabled) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para usar comprovantes no Supabase Storage.');
  }
}

function sanitizeFileName(fileName = 'arquivo.bin') {
  return String(fileName)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'arquivo.bin';
}

function buildObjectPath(originalName = '', prefix = 'receipt') {
  const ext = path.extname(originalName || '') || '.bin';
  const base = path.basename(originalName || `arquivo${ext}`, ext);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}/${stamp}-${sanitizeFileName(base)}${ext}`;
}

async function uploadReceiptBuffer({ buffer, fileName, mimeType, objectPath }) {
  ensureStorageEnabled();
  const finalPath = objectPath || buildObjectPath(fileName, 'receipt');
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(finalPath, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw error;
  return finalPath;
}

async function uploadLocalReceiptFile(localPath, objectPath, mimeType = 'application/octet-stream') {
  const buffer = fs.readFileSync(localPath);
  return uploadReceiptBuffer({
    buffer,
    fileName: path.basename(localPath),
    mimeType,
    objectPath,
  });
}

async function downloadReceiptObject(objectPath) {
  ensureStorageEnabled();
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).download(objectPath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function deleteReceiptObject(objectPath) {
  if (!objectPath) return;

  if (!storageEnabled) {
    const fullPath = path.join(RECEIPTS_DIR, objectPath);
    try { fs.unlinkSync(fullPath); } catch { /* noop */ }
    return;
  }

  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([objectPath]);
  if (error) throw error;
}

module.exports = {
  STORAGE_DIR,
  RECEIPTS_DIR,
  RECEIPTS_BUCKET,
  storageEnabled,
  ensureStorageEnabled,
  buildObjectPath,
  uploadReceiptBuffer,
  uploadLocalReceiptFile,
  downloadReceiptObject,
  deleteReceiptObject,
};
