@echo off
chcp 65001 >nul
title Meu TEA
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado neste computador.
  echo  Vou abrir o site para baixar. Instale a versao LTS e depois abra este arquivo de novo.
  echo.
  start "" https://nodejs.org/pt
  pause
  exit /b
)

if not exist node_modules (
  echo Instalando o Meu TEA pela primeira vez. Isso leva alguns minutos...
  call npm install
  if errorlevel 1 (
    echo Nao foi possivel instalar. Verifique a internet e tente de novo.
    pause
    exit /b
  )
)

set MEUTEA_DEMO=1
echo.
echo  Meu TEA iniciando... o navegador vai abrir em instantes.
echo  Para ENCERRAR, feche esta janela.
echo.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm start
pause
