@echo off
chcp 65001 >nul
title Advanced Moss Branch - Install and Start
cd /d "%~dp0"
echo ========================================
echo Advanced Moss Branch - INSTALL AND START
echo ========================================
echo.
echo [1/2] Installing dependencies...
npm install
if errorlevel 1 (
  echo.
  echo [Error] npm install failed. Try: npm config set registry https://registry.npmmirror.com
  pause
  exit /b 1
)
echo.
echo [2/2] Starting development server...
npm run dev
pause
