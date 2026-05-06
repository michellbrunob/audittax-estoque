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

export function createHandler(rewriteUrl) {
  return async function handler(req, res) {
    if (typeof rewriteUrl === 'function') {
      req.url = rewriteUrl(req.url || '', req);
    } else {
      normalizeApiUrl(req);
    }

    if (!initPromise) {
      initPromise = initDatabase();
    }

    await initPromise;
    return app(req, res);
  };
}

export default createHandler();
