import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const app = require('../backend/server.js');
const { initDatabase } = require('../backend/db/database.js');

let initPromise = null;

export default async function handler(req, res) {
  if (!initPromise) {
    initPromise = initDatabase();
  }

  await initPromise;
  return app(req, res);
}
