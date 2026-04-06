@echo off
chcp 65001 >nul
title Audittax — Instalar Servico Windows

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   Instalando como Servico Windows        ║
echo  ║   (execute como Administrador)           ║
echo  ╚══════════════════════════════════════════╝
echo.

:: Verifica privilégio de administrador
net session >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] Execute este arquivo como Administrador.
    echo  Clique com botao direito > "Executar como administrador"
    pause
    exit /b 1
)

:: Verifica Node
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] Node.js nao encontrado. Instale em https://nodejs.org
    pause
    exit /b 1
)

:: Instala PM2 globalmente se não existir
where pm2 >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Instalando PM2...
    call npm install -g pm2
    call npm install -g pm2-windows-startup
)

:: Cria pasta de logs
if not exist "%~dp0logs" mkdir "%~dp0logs"

:: Gera o build do frontend
echo  [INFO] Gerando build do frontend...
cd /d "%~dp0"
call node_modules\.bin\vite build

:: Inicia com PM2
echo  [INFO] Iniciando com PM2...
cd /d "%~dp0"
call pm2 start ecosystem.config.cjs

:: Configura inicialização automática no Windows
echo  [INFO] Configurando inicio automatico no boot...
call pm2-startup install
call pm2 save

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║  [OK] Servico instalado com sucesso!     ║
echo  ║  Acesse: http://localhost:3333           ║
echo  ║                                          ║
echo  ║  Comandos uteis:                         ║
echo  ║    pm2 status       — ver status         ║
echo  ║    pm2 logs         — ver logs ao vivo   ║
echo  ║    pm2 restart all  — reiniciar          ║
echo  ║    pm2 stop all     — parar              ║
echo  ╚══════════════════════════════════════════╝
echo.
pause
