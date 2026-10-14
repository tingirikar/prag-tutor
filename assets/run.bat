@echo off
echo Starting PRAG-TUTOR services...

:: Terminal 1: Tutor AI Service (Port 8000)
start "PRAG-Tutor - AI Service (8000)" cmd /k "cd tutor && .venv\Scripts\activate && py -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

:: Terminal 2: Express Backend (Port 5000)
start "PRAG-Tutor - Backend (5000)" cmd /k "cd backend && npm run dev"

:: Terminal 3: Vite Frontend (Port 5173)
start "PRAG-Tutor - Frontend (5173)" cmd /k "cd frontend && npm run dev"

:: Optional: Wait 3 seconds and open the app in your default browser
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo All services launched!
