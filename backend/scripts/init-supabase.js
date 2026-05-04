require('dotenv').config();

const { initDatabase, pool } = require('../db/database.js');

async function main() {
  await initDatabase();
  console.log('Schema Supabase/Postgres inicializado com sucesso.');
}

main()
  .catch((error) => {
    console.error('Falha ao inicializar o banco:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
