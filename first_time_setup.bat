@echo off
setlocal
cd /d "%~dp0"

echo.
echo ColdTrack first-time setup
echo =========================
echo.

call :find_python
if not errorlevel 1 goto python_ready

echo Python 3.10 or newer was not found.
where winget >nul 2>nul
if errorlevel 1 goto manual_install

choice /C YN /M "Install Python 3.12 now using Windows Package Manager"
if errorlevel 2 goto manual_install

echo.
echo Installing Python 3.12. This may take a few minutes.
winget install --id Python.Python.3.12 --exact --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo.
    echo The automatic Python installation did not complete.
    goto manual_install
)

set "PYTHON_CMD=py -3.12"
%PYTHON_CMD% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 (
    echo Python installation finished, but Python 3.12 is not available in this command prompt yet.
    echo Close this window, open a new one, and run first_time_setup.bat again.
    pause
    exit /b 1
)
goto python_ready

:manual_install
echo.
echo Install Python 3.10 or newer from:
echo https://www.python.org/downloads/windows/
echo Select "Add python.exe to PATH" in the installer if that option is shown.
start "" "https://www.python.org/downloads/windows/"
pause
call :find_python
if errorlevel 1 (
    echo Python 3.10 or newer is still not available. Setup cannot continue.
    pause
    exit /b 1
)

:python_ready
echo Using %PYTHON_CMD%

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo Creating the ColdTrack virtual environment...
    %PYTHON_CMD% -m venv .venv
    if errorlevel 1 goto setup_failed
)

echo.
echo Installing required packages...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto setup_failed

echo.
if not exist "instance\sorter.sqlite3" goto create_admin
".venv\Scripts\python.exe" -c "import sqlite3,sys; c=sqlite3.connect('instance/sorter.sqlite3'); t=c.execute('SELECT name FROM sqlite_master WHERE type=? AND name=?', ('table','users')).fetchone(); sys.exit(0 if t and c.execute('SELECT 1 FROM users WHERE role=? LIMIT 1', ('admin',)).fetchone() else 1)"
if not errorlevel 1 (
    echo An administrator account already exists; it was left unchanged.
    goto setup_complete
)

:create_admin
echo Create the first administrator account now.
echo You will be asked for a username, display name, and password.
".venv\Scripts\python.exe" app.py create-admin
if errorlevel 1 goto setup_failed

:setup_complete
echo.
echo Setup is complete.
echo Start ColdTrack by double-clicking run_app.bat.
echo Employees on the office network can connect to this computer on port 8000.
echo.
pause
exit /b 0

:find_python
set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_CMD=py -3"
        exit /b 0
    )
)
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
        exit /b 0
    )
)
exit /b 1

:setup_failed
echo.
echo Setup did not complete. Review the error above, then run this file again.
pause
exit /b 1
