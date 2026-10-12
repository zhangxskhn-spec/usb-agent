@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem USB Agent portable launcher. All paths are resolved from this file.
title USB AI Workspace

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "USBAI_ROOT=%ROOT%"
set "AI_REAL_USERPROFILE=%USERPROFILE%"
set "WORKSPACES_ROOT=%ROOT%\workspace"

rem Keep application state and Claude data on the USB drive.
set "HOME=%ROOT%\data\home"
set "USERPROFILE=%HOME%"
set "APPDATA=%HOME%\AppData\Roaming"
set "LOCALAPPDATA=%HOME%\AppData\Local"
set "TEMP=%HOME%\temp"
set "TMP=%TEMP%"
set "CLAUDE_CONFIG_DIR=%HOME%\.claude"
set "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
set "DISABLE_AUTOUPDATER=1"
set "NPM_CONFIG_CACHE=%HOME%\.npm-cache"
set "CLAUDE_CODE_GIT_BASH_PATH=%ROOT%\runtime\git\bin\bash.exe"
set "PATH=%ROOT%\runtime\node;%ROOT%\runtime\git\cmd;%PATH%"
set "USB_BROWSER_PROFILE=%ROOT%\data\browser-profile"

if not exist "%HOME%\temp" mkdir "%HOME%\temp" >nul 2>&1
if not exist "%HOME%\.claude" mkdir "%HOME%\.claude" >nul 2>&1
if not exist "%HOME%\AppData\Roaming" mkdir "%HOME%\AppData\Roaming" >nul 2>&1
if not exist "%HOME%\AppData\Local" mkdir "%HOME%\AppData\Local" >nul 2>&1
if not exist "%ROOT%\workspace" mkdir "%ROOT%\workspace" >nul 2>&1

if not exist "%ROOT%\runtime\node\node.exe" (
  echo.
  echo [ERROR] Missing runtime\node\node.exe.
  echo         The USB runtime is incomplete.
  pause
  exit /b 1
)
if not exist "%ROOT%\runtime\node\cloudcli.cmd" (
  echo.
  echo [ERROR] Missing runtime\node\cloudcli.cmd.
  echo         The CloudCLI runtime is incomplete.
  pause
  exit /b 1
)
if not exist "%ROOT%\app\webui" (
  echo.
  echo [ERROR] Missing app\webui.
  echo         The project files are incomplete.
  pause
  exit /b 1
)
if not exist "%ROOT%\config\keys.env" (
  echo.
  echo [ERROR] Missing config\keys.env.
  pause
  exit /b 1
)

rem Read key and model settings. A later data\home\keys.env may override them.
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ROOT%\config\keys.env") do (
  if not "%%~A"=="" set "%%~A=%%~B"
)
if exist "%HOME%\keys.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%HOME%\keys.env") do (
    if not "%%~A"=="" set "%%~A=%%~B"
  )
)
if not defined MIMO_MODEL set "MIMO_MODEL=mimo-v2.6-flash"
if not defined DEEPSEEK_MODEL set "DEEPSEEK_MODEL=deepseek-v4-pro"
if not defined DEFAULT_MODEL set "DEFAULT_MODEL=mimo-v2.6-flash"
set "DEFAULT_MODEL=%DEFAULT_MODEL:[1m]=%"

:menu
cls
echo.
echo ================================================================
echo                         USB AI WORKSPACE
echo ================================================================
echo.
if defined MIMO_API_KEY (echo   MiMo key:      OK) else (echo   MiMo key:      Missing)
if defined DEEPSEEK_API_KEY (echo   DeepSeek key:  OK) else (echo   DeepSeek key:  Missing)
echo   Config:        config\keys.env
echo   Runtime:       USB runtime\node
echo.
echo   [1] Web interface
echo   [2] Terminal (Claude Code)
echo   [3] Environment self-check
echo   [0] Exit
echo.
choice /c 1230 /n /m "Select: "
set "SELECTED=%ERRORLEVEL%"
if "%SELECTED%"=="4" goto :cleanup
if "%SELECTED%"=="3" (
  call "%ROOT%\tools\selfcheck.bat"
  pause
  goto :menu
)
if "%SELECTED%"=="2" (
  set "MODE=term"
  goto :start_services
)
if "%SELECTED%"=="1" (
  set "MODE=web"
  goto :start_services
)
goto :menu

:start_services
pushd "%ROOT%"
for /f "delims=" %%P in ('call "%ROOT%\runtime\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" find-port 3001') do set "WEBPORT=%%P"
for /f "delims=" %%P in ('call "%ROOT%\runtime\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" find-port 4567') do set "GWPORT=%%P"
popd
if not defined WEBPORT set "WEBPORT=3001"
if not defined GWPORT set "GWPORT=4567"

set "ANTHROPIC_BASE_URL=http://127.0.0.1:%GWPORT%"
set "SERVER_PORT=%WEBPORT%"
set "HOST=127.0.0.1"
set "ANTHROPIC_AUTH_TOKEN=usbai-local-gw"
set "ANTHROPIC_API_KEY="
set "ANTHROPIC_MODEL=%DEFAULT_MODEL%"
set "ANTHROPIC_DEFAULT_SONNET_MODEL=%DEFAULT_MODEL%"
set "ANTHROPIC_DEFAULT_OPUS_MODEL=%DEFAULT_MODEL%"
set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%DEFAULT_MODEL%"

echo.
echo [1/2] Starting local model gateway on port %GWPORT%...
pushd "%ROOT%"
for /f "delims=" %%P in ('call "%ROOT%\runtime\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" start-gateway %GWPORT%') do set "GATEWAY_PID=%%P"
popd

set "GATEWAY_READY="
for /l %%I in (1,1,20) do (
  if not defined GATEWAY_READY (
    "%ROOT%\runtime\node\node.exe" -e "fetch('http://127.0.0.1:%GWPORT%/health').then(r=>r.text()).then(t=>{if(t.includes('usbai'))process.exit(0);process.exit(1)}).catch(()=>process.exit(1))" >nul 2>&1
    if not errorlevel 1 set "GATEWAY_READY=1"
    if not defined GATEWAY_READY ping -n 2 127.0.0.1 >nul
  )
)
if defined GATEWAY_READY (echo       Gateway ready.) else echo       [WARN] Gateway health check timed out.

if "%MODE%"=="term" goto :terminal

echo [2/2] Starting web interface on http://127.0.0.1:%WEBPORT%
echo       Browser profile: data\browser-profile
echo       Close this window before safely ejecting the USB drive.
echo.
start "" /b "%ROOT%\tools\open-when-ready.bat" %WEBPORT%
pushd "%ROOT%\app\webui"
call "%ROOT%\runtime\node\cloudcli.cmd" start
popd
goto :cleanup

:terminal
echo [2/2] Starting Claude Code in workspace\
echo       Type /exit to return to this menu.
echo.
pushd "%ROOT%\workspace"
call "%ROOT%\runtime\node\claude.cmd"
popd
goto :cleanup

:cleanup
if exist "%ROOT%\runtime\node\node.exe" (
  "%ROOT%\runtime\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" stop-gateway >nul 2>&1
)
endlocal
exit /b 0

