@echo off
rem EXEGEZIS: starts the local app (http://127.0.0.1:4100) and opens it in the browser.
rem Double-click this file, or run it from CMD in the repository folder.
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm is not installed. Install Node.js 22.18+ from https://nodejs.org/ and then run: npm install -g pnpm
  pause
  exit /b 1
)
start "" /min cmd /c "for /l %%i in (1,1,120) do (curl -s -o nul http://127.0.0.1:4100/ && (start "" http://127.0.0.1:4100/ & exit) || timeout /t 2 /nobreak >nul)"
pnpm web
