@echo off
setlocal
pushd "%~dp0" || exit /b 1

where node.exe >nul 2>&1 || goto :missing_node
where npm.cmd >nul 2>&1 || goto :missing_node

if not exist ".env" (
    copy /-y ".env.example" ".env" >nul || goto :failed
    echo Created .env. Fill in your service credentials before running the app.
)

if not exist "tutor\.venv\Scripts\python.exe" (
    py -3 -c "import sys; sys.exit(not sys.version_info >= (3, 10))" >nul 2>&1
    if errorlevel 1 (
        python -c "import sys; sys.exit(not sys.version_info >= (3, 10))" >nul 2>&1 || goto :missing_python
        python -m venv "tutor\.venv" || goto :failed
    ) else (
        py -3 -m venv "tutor\.venv" || goto :failed
    )
)

echo Installing tutor dependencies...
"tutor\.venv\Scripts\python.exe" -m pip install -r "tutor\requirements.txt" || goto :failed
echo Installing backend dependencies...
call npm.cmd --prefix "%CD%\backend" ci || goto :failed
echo Installing frontend dependencies...
call npm.cmd --prefix "%CD%\frontend" ci || goto :failed

echo Setup complete. Start the app with run.bat.
popd
exit /b 0

:missing_python
echo Python 3.10 or newer is required.
goto :failed

:missing_node
echo Node.js and npm are required.

:failed
echo Setup failed. See the output above.
popd
exit /b 1
