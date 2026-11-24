@echo off
setlocal
pushd "%~dp0" || exit /b 1

if not exist ".env" goto :setup_required
if not exist "tutor\.venv\Scripts\python.exe" goto :setup_required
if not exist "backend\node_modules\express\package.json" goto :setup_required
if not exist "frontend\node_modules\.bin\vite.cmd" goto :setup_required
tutor\.venv\Scripts\python.exe -c "import uvicorn" >nul 2>&1 || goto :setup_required
where node.exe >nul 2>&1 || goto :setup_required
where npm.cmd >nul 2>&1 || goto :setup_required

start "PRAG-TUTOR - Tutor" /D "%CD%\tutor" "%ComSpec%" /d /k .venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload || goto :launch_failed
start "PRAG-TUTOR - Backend" /D "%CD%\backend" "%ComSpec%" /d /k npm.cmd run dev || goto :launch_failed
start "PRAG-TUTOR - Frontend" /D "%CD%\frontend" "%ComSpec%" /d /k npm.cmd run dev || goto :launch_failed

echo Check the frontend console for the local URL. The default is http://localhost:5173.
popd
exit /b 0

:setup_required
echo Setup is required. Run setup.bat first and fill in your .env credentials.
popd
exit /b 1

:launch_failed
echo A service window could not be opened. Check any windows that already opened.
popd
exit /b 1
