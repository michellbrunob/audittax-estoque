module.exports = {
  apps: [
    {
      name: 'audittax-estoque',
      script: './backend/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,          // reinicia automaticamente se travar
      watch: false,               // não observar arquivos em produção
      max_memory_restart: '300M', // reinicia se consumir mais de 300 MB
      env: {
        NODE_ENV: 'production',
        PORT: 3333,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
    },
  ],
};
