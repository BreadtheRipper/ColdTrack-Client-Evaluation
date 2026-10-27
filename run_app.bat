@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ColdTrack has not been set up on this computer yet.
    call "%~dp0first_time_setup.bat"
    if errorlevel 1 exit /b 1
)

echo.
echo Starting ColdTrack for the office network...
echo On this computer: http://localhost:8000
echo Other employees: http://HOST-IP:8000
echo Keep this window open while ColdTrack is in use.
echo Press Ctrl+C in this window to stop the server.
echo.
".venv\Scripts\python.exe" app.py serve --host 0.0.0.0 --port 8000

if errorlevel 1 (
    echo.
    echo ColdTrack stopped with an error. Review the message above.
    pause
    exit /b 1
)
