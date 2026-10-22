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
rem Claude Code drops ALL colour when TERM=dumb (some shells set it), which turns
rem the whole TUI grey and makes the logo look like a broken blob. Clear it.
set "TERM="
set "NPM_CONFIG_CACHE=%HOME%\.npm-cache"
rem Browser profile lives on THIS machine, not on the USB: leftover Edge processes
rem (crashpad etc.) would otherwise keep holding the drive and block ejection.
set "USB_BROWSER_PROFILE=%AI_REAL_USERPROFILE%\AppData\Local\usb-agent-browser-profile"

if not exist "%HOME%\temp" mkdir "%HOME%\temp" >nul 2>&1
if not exist "%HOME%\.claude" mkdir "%HOME%\.claude" >nul 2>&1
if not exist "%HOME%\AppData\Roaming" mkdir "%HOME%\AppData\Roaming" >nul 2>&1
if not exist "%HOME%\AppData\Local" mkdir "%HOME%\AppData\Local" >nul 2>&1
if not exist "%ROOT%\workspace" mkdir "%ROOT%\workspace" >nul 2>&1

rem Locate the runtime. Two layouts are supported:
rem   A) runtime\ sits next to this file (dev copy / old USB layout)
rem   B) only runtime.zip + runtime.sha256 exist -> unpack to THIS machine once
rem      (see tools\deploy-to-usb.bat). Keeps the USB at ~1 big file instead of
rem      48k small ones, which is what makes copying to a flash drive so slow.
call "%ROOT%\tools\runtime-home.bat"
if not defined USBAI_RUNTIME (
  echo.
  echo [ERROR] No usable runtime found.
  echo         Either place runtime\ next to START.bat, or ship runtime.zip +
  echo         runtime.sha256 ^(generate with tools\deploy-to-usb.bat^).
  pause
  exit /b 1
)
set "CLAUDE_CODE_GIT_BASH_PATH=%USBAI_RUNTIME%\git\bin\bash.exe"
set "PATH=%USBAI_RUNTIME%\node;%USBAI_RUNTIME%\git\cmd;%PATH%"

if not exist "%USBAI_RUNTIME%\node\cloudcli.cmd" (
  echo.
  echo [ERROR] Missing cloudcli.cmd under:
  echo         %USBAI_RUNTIME%\node
  echo         The runtime is incomplete.
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
echo   Runtime:       %USBAI_RUNTIME%
if defined WEB_RUNNING (echo   Web:           running on http://127.0.0.1:%WEBPORT%) else (echo   Web:           not started)
echo.
echo   [1] Web interface      (runs in background, this menu stays open)
echo   [2] Terminal (Claude Code)
echo   [3] Environment self-check
echo   [0] Exit                 (stop every project process; eject USB yourself)
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
rem Gateway and ports are resolved once per launcher session. Re-entering the
rem menu must not spawn a second gateway or a second web server.
if defined SERVICES_UP goto :dispatch
pushd "%ROOT%"
for /f "delims=" %%P in ('call "%USBAI_RUNTIME%\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" find-port 3001') do set "WEBPORT=%%P"
for /f "delims=" %%P in ('call "%USBAI_RUNTIME%\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" find-port 4567') do set "GWPORT=%%P"
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
rem NOTE: this file must stay pure ASCII + CRLF. Chinese comments in a .bat get
rem mangled by the console code page and can break parsing (project convention).
rem
rem supervise = a resident watchdog: it starts the gateway and then stays alive,
rem sharing this console. Closing the window kills the watchdog, and the Job
rem Object then takes the gateway down with it (so the USB can be ejected).
rem Do NOT use start-gateway here: a detached:false child is killed as soon as
rem its parent exits, so the gateway would never survive.
pushd "%ROOT%"
start "" /b "%USBAI_RUNTIME%\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" supervise %GWPORT%
popd

set "GATEWAY_READY="
for /l %%I in (1,1,20) do (
  if not defined GATEWAY_READY (
    "%USBAI_RUNTIME%\node\node.exe" -e "fetch('http://127.0.0.1:%GWPORT%/health').then(r=>r.text()).then(t=>{if(t.includes('usbai'))process.exit(0);process.exit(1)}).catch(()=>process.exit(1))" >nul 2>&1
    if not errorlevel 1 set "GATEWAY_READY=1"
    if not defined GATEWAY_READY ping -n 2 127.0.0.1 >nul
  )
)
if defined GATEWAY_READY (echo       Gateway ready.) else echo       [WARN] Gateway health check timed out.
set "SERVICES_UP=1"

:dispatch
if "%MODE%"=="term" goto :terminal
goto :web

:web
if defined WEB_RUNNING (
  echo.
  echo       Web server is already running on http://127.0.0.1:%WEBPORT%
  echo       Opening the browser again...
  start "" /b cmd /c ""%ROOT%\tools\open-when-ready.bat" %WEBPORT% >> "%ROOT%\data\run\open-browser.log" 2>&1"
  timeout /t 2 >nul
  goto :menu
)
echo [2/2] Starting web interface on http://127.0.0.1:%WEBPORT%
echo       Browser profile: (this machine) usb-agent-browser-profile
echo       The server runs in the background -- this menu stays usable.
echo.
if not exist "%ROOT%\data\run" mkdir "%ROOT%\data\run" >nul 2>&1
pushd "%ROOT%\app\webui"
start "" /b cmd /c ""%USBAI_RUNTIME%\node\cloudcli.cmd" start >> "%ROOT%\data\run\webui.log" 2>&1"
popd
set "WEB_RUNNING=1"
rem Wait until the port actually answers before showing the menu again.
rem Without this the menu reappears in 2s while cloudcli is still booting, so
rem (a) the status flashes past and (b) pressing [0] too early cannot find the
rem listener and leaves the server running.
set "WEB_READY="
for /l %%I in (1,1,15) do (
  if not defined WEB_READY (
    "%USBAI_RUNTIME%\node\node.exe" -e "fetch('http://127.0.0.1:%WEBPORT%/').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>&1
    if not errorlevel 1 set "WEB_READY=1"
    if not defined WEB_READY ping -n 2 127.0.0.1 >nul
  )
)
if defined WEB_READY (echo       Web ready on http://127.0.0.1:%WEBPORT%) else (echo       [WARN] No response after 15s - see data\run\webui.log)
start "" /b cmd /c ""%ROOT%\tools\open-when-ready.bat" %WEBPORT% >> "%ROOT%\data\run\open-browser.log" 2>&1"
echo       Logs: data\run\webui.log + open-browser.log
echo       Use [0] when you are done -- it stops every process.
echo.
goto :menu

:terminal
echo [2/2] Starting Claude Code in workspace\
echo       Type /exit to come back to this menu.
echo.
echo   Permission mode: Auto (Shift+Tab cycles Auto / Plan / Allow all / Manual)
set "WBPM=--permission-mode acceptEdits"
echo.
pushd "%ROOT%\workspace"
rem --allow-dangerously-skip-permissions only authorises bypass, it does not force it.
call "%USBAI_RUNTIME%\node\claude.cmd" %WBPM% --allow-dangerously-skip-permissions
popd
echo.
echo Back to the menu. The local gateway is still running.
echo Choose [0] when you want to stop every process.
timeout /t 3 >nul
goto :menu

:cleanup
rem Full shutdown: the browser supervisor and its browser children can keep a
rem working directory or loaded module on the USB even when the profile lives
rem on the host. Stop the web listener first, then stop every package process.
call :kill_web
if exist "%USBAI_RUNTIME%\node\node.exe" (
  "%USBAI_RUNTIME%\node\node.exe" "%ROOT%\tools\portable-runtime.mjs" stop-all >nul 2>&1
)
echo.
echo Stopped the gateway, web server, browser, and package supervisors.
echo The project is closed. Close any Explorer window or preview pane on this drive,
echo then eject the USB from the Windows tray.
rem Move this launcher off the USB before it exits, so its working directory
rem cannot keep the volume busy while the user ejects it.
cd /d "%SystemRoot%"
endlocal
exit /b 0

:kill_web
rem End the background web server (cloudcli) for this session. The listener
rem has no package pid file, so close its process tree before stop-all.
if not defined WEBPORT goto :eof
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%WEBPORT% " ^| findstr LISTENING') do taskkill /T /F /PID %%P >nul 2>&1
goto :eof
