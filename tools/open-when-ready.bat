@echo off
rem ============================================================
rem  Wait for the web UI then open it (thin wrapper).
rem  Real work lives in tools\open-browser.mjs (reliable browser
rem  detection + U-disk profile + console-shared lifetime).
rem  Usage: open-when-ready.bat [port]     default 3001
rem ============================================================
setlocal
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3001"
call "%~dp0runtime-home.bat"
if not defined USBAI_RUNTIME exit /b 1
"%USBAI_RUNTIME%\node\node.exe" "%~dp0open-browser.mjs" %PORT%
exit /b 0
