@echo off
echo ===========================================
echo   Starting Taipei AI Tour Guide Project
echo ===========================================

echo [1/3] Starting Python Backend (FastAPI on Port 8000)...
start cmd /k "uvicorn api.index:app --reload"

echo [2/3] Starting Hotel Safe API (Node.js on Port 3001)...
start cmd /k "cd hotel_safe && set PORT=3001 && node server.js"

echo [3/3] Starting Main Dev Server (Express on Port 3000)...
start cmd /k "node local_dev.js"

echo.
echo All services are booting up in separate windows!
echo Please wait a few seconds, then open your browser and go to:
echo.
echo   http://localhost:3000
echo.
pause
