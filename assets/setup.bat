@echo off
echo ===================================================
echo           PRAG-TUTOR - One-Click Setup
echo ===================================================

:: 1. Copy .env if not present
if not exist ".env" (
    echo [1/4] Creating .env from .env.example...
    copy .env.example .env
    echo Please make sure to update your API keys in .env!
) else (
    echo [1/4] .env already exists. Skipping copy.
)

:: 2. Tutor Python environment & dependencies
echo [2/4] Setting up Tutor Python environment...
cd tutor
if not exist ".venv" (
    echo Creating virtual environment...
    py -m venv .venv
)
call .venv\Scripts\activate
call pip install -r requirements.txt
cd ..

:: 3. Backend npm dependencies
echo [3/4] Installing Backend dependencies...
cd backend
call npm install
cd ..

:: 4. Frontend npm dependencies
echo [4/4] Installing Frontend dependencies...
cd frontend
call npm install
cd ..

echo ===================================================
echo Setup complete! Remember to configure your .env file.
echo ===================================================
pause
