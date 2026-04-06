@echo off
chcp 65001 >nul
title Audittax - Controle de Estoque

:: Define o diretorio raiz do projeto (onde este .bat esta)
set "ROOT=%~dp0"
:: Remove a barra final se existir
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo  ============================================
echo   Audittax - Controle de Estoque
echo  ============================================
echo.

:: Verifica Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] Node.js nao encontrado.
    echo  Baixe em: https://nodejs.org
    pause
    exit /b 1
)

:: Gera o build do frontend se nao existir
if not exist "%ROOT%\dist\index.html" (
    echo  [INFO] Gerando build do frontend...
    cd /d "%ROOT%"
    call node_modules\.bin\vite.cmd build
    if errorlevel 1 (
        echo  [ERRO] Falha ao gerar build do frontend.
        pause
        exit /b 1
    )
    echo  [OK] Build gerado com sucesso.
)

:: Abre o navegador apos 3 segundos (em segundo plano)
start /b cmd /c "ping -n 4 127.0.0.1 >nul && start http://localhost:3333"

:: Inicia o backend
echo  [OK] Iniciando servidor em http://localhost:3333
echo  [INFO] Feche esta janela para encerrar o sistema.
echo.
cd /d "%ROOT%\backend"
node server.js

echo.
echo  Servidor encerrado.
pause
