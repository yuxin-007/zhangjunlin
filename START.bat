@echo off
chcp 65001 >nul
title Advanced Moss Branch - Start
cd /d "%~dp0"
echo ========================================
echo Advanced Moss Branch - START
echo ========================================
echo.
if not exist node_modules (
  echo [Info] node_modules not found. Please run INSTALL_AND_START.bat first, or run npm install manually.
  echo.
  pause
  exit /b 1
)
npm run dev
pause
