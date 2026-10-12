@echo off
rem ============================================================
rem  ??????????????????????????????????? ping ?????
rem  ???: open-when-ready.bat [???]   ??? 3001
rem ============================================================
setlocal EnableDelayedExpansion
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3001"
set "URL=http://127.0.0.1:%PORT%"
set "PROFILE=%USB_BROWSER_PROFILE%"
if "%PROFILE%"=="" set "PROFILE=%~dp0..\data\browser-profile"
if not exist "%PROFILE%" mkdir "%PROFILE%" >nul 2>&1

where curl >nul 2>&1
if not %errorlevel%==0 (
  rem ??? curl ???????????????? ~6 ??
  ping -n 7 127.0.0.1 >nul
  call :open_browser
  exit /b 0
)

rem ???? ~90 ??45 ?? x ? 2 ??
for /l %%i in (1,1,45) do (
  curl -s -m 2 -o nul "%URL%" 2>nul
  if !errorlevel!==0 (
    call :open_browser
    exit /b 0
  )
  ping -n 3 127.0.0.1 >nul
)
rem ?????????????????????????????????????
call :open_browser
exit /b 0

:open_browser
set "BROWSER="
rem ?? PATH ????????????? ProgramFiles(x86) ???
for /f "delims=" %%E in ('where msedge.exe 2^>nul') do if not defined BROWSER set "BROWSER=%%E"
for /f "delims=" %%E in ('where chrome.exe 2^>nul') do if not defined BROWSER set "BROWSER=%%E"
rem PATH ???????????????????????????????????
set "PF86=%ProgramFiles(x86)%"
set "PF=%ProgramFiles%"
set "LA=%LocalAppData%"
if not defined BROWSER if exist "!PF86!\Microsoft\Edge\Application\msedge.exe" set "BROWSER=!PF86!\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "!PF!\Microsoft\Edge\Application\msedge.exe" set "BROWSER=!PF!\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "!LA!\Google\Chrome\Application\chrome.exe" set "BROWSER=!LA!\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "!PF!\Google\Chrome\Application\chrome.exe" set "BROWSER=!PF!\Google\Chrome\Application\chrome.exe"
if defined BROWSER (
  start "" "%BROWSER%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --new-window "%URL%"
) else (
  rem ????? Edge/Chrome ??????????????????
  start "" "%URL%"
)
exit /b 0
