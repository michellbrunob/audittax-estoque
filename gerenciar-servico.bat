@echo off
chcp 65001 >nul
title Audittax — Gerenciar Servico

:menu
cls
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   Audittax — Gerenciamento do Servico    ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  [1] Ver status
echo  [2] Ver logs ao vivo
echo  [3] Reiniciar servico
echo  [4] Parar servico
echo  [5] Iniciar servico
echo  [6] Abrir no navegador
echo  [7] Sair
echo.
set /p op="  Escolha uma opcao: "

if "%op%"=="1" (
    call pm2 status
    pause
    goto menu
)
if "%op%"=="2" (
    call pm2 logs audittax-estoque
    goto menu
)
if "%op%"=="3" (
    call pm2 restart audittax-estoque
    echo  [OK] Reiniciado.
    pause
    goto menu
)
if "%op%"=="4" (
    call pm2 stop audittax-estoque
    echo  [OK] Parado.
    pause
    goto menu
)
if "%op%"=="5" (
    call pm2 start audittax-estoque
    echo  [OK] Iniciado.
    pause
    goto menu
)
if "%op%"=="6" (
    start http://localhost:3333
    goto menu
)
if "%op%"=="7" exit /b 0

goto menu
