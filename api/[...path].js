const app = require('../backend/server.js');
const { initDatabase } = require('../backend/db/database.js');

let initPromise = null;

module.exports = async (req, res) => {
  if (!initPromise) {
    initPromise = initDatabase();
  }

  await initPromise;
  return app(req, res);
};
