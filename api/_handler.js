import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const app = require('../backend/server.js');
const { initDatabase } = require('../backend/db/database.js');

let initPromise = null;

function normalizeApiUrl(req) {
  if (!req || typeof req.url !== 'string') return;
  if (req.url.startsWith('/api/')) return;
  const prefix = req.url.startsWith('/') ? '' : '/';
  req.url = `/api${prefix}${req.url}`;
}

export default async function handler(req, res) {
  normalizeApiUrl(req);

  if (!initPromise) {
    initPromise = initDatabase();
  }

  await initPromise;
  return app(req, res);
}
