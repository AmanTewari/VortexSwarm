@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "PID_FILE=%ROOT%.vortexswarm.pid"
set "NODE_CMD=node"

if not defined WEB_PORT set "WEB_PORT=3000"

if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles(x86)%\nodejs\node.exe"

if not exist "%PID_FILE%" type nul > "%PID_FILE%"

:menu
cls
echo VortexSwarm Localhost Server
echo.
echo 1. Start server
echo 2. Stop server
echo 3. Restart server
echo 4. Server status
echo 5. Exit
echo.
set /p "choice=Choose an option [1-5]: "

if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto status
if "%choice%"=="5" exit /b 0

echo Invalid choice.
pause
goto menu

:start
call :get_pid
if defined SERVER_PID (
  tasklist /FI "PID eq !SERVER_PID!" | find "!SERVER_PID!" >nul
  if not errorlevel 1 (
    echo Server is already running with PID !SERVER_PID!.
    pause
    goto menu
  )
)

echo Starting server on http://localhost:%WEB_PORT% ...
powershell -NoProfile -Command "$p = Start-Process -FilePath '%NODE_CMD%' -ArgumentList 'index.js' -WorkingDirectory '%ROOT%' -PassThru; Set-Content -Path '%PID_FILE%' -Value $p.Id"
if errorlevel 1 (
  echo Failed to start the server.
) else (
  call :get_pid
  echo Server started with PID !SERVER_PID!.
)
pause
goto menu

:stop
call :stop_now
pause
goto menu

:restart
call :stop_now
call :start
goto menu

:status
call :get_pid
if defined SERVER_PID (
  tasklist /FI "PID eq !SERVER_PID!" | find "!SERVER_PID!" >nul
  if not errorlevel 1 (
    echo Server is running with PID !SERVER_PID!.
    echo Open http://localhost:%WEB_PORT%
  ) else (
    echo Saved PID !SERVER_PID! is not running.
  )
) else (
  echo Server is not running.
)
pause
goto menu

:get_pid
set "SERVER_PID="
if exist "%PID_FILE%" (
  set /p "SERVER_PID=" < "%PID_FILE%"
)
exit /b 0

:stop_now
call :get_pid
if not defined SERVER_PID (
  echo Server is not currently running.
  call :stop_by_port
  exit /b 0
)

taskkill /PID !SERVER_PID! /T /F >nul 2>&1
if errorlevel 1 (
  echo Could not stop process !SERVER_PID! directly.
  call :stop_by_port
) else (
  echo Stopped server process !SERVER_PID!.
)
>"%PID_FILE%" echo.
exit /b 0

:stop_by_port
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%WEB_PORT% .*LISTENING"') do (
  taskkill /PID %%P /T /F >nul 2>&1
  if not errorlevel 1 echo Stopped process on port %WEB_PORT% (PID %%P).
)
exit /b 0
