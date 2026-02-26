@echo off
title Calculated Risk - Setup
echo.
echo ============================================
echo   CALCULATED RISK - SETUP
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js is not installed.
    echo.
    echo Opening the Node.js download page...
    echo Download and install the LTS version, then run this script again.
    echo.
    start https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js found:
node --version
echo.

:: Install dependencies
echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed. Make sure Node.js installed correctly.
    pause
    exit /b 1
)
echo.
echo [OK] Dependencies installed.
echo.

:: Start the server
echo Starting the game server...
echo.
echo ============================================
echo   Open your browser to:
echo   http://localhost:3000
echo ============================================
echo.
echo Press Ctrl+C to stop the server.
echo.
call npm start
