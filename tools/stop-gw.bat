@echo off
rem Stop only the gateway recorded by this launcher.
setlocal
pushd "%~dp0.."
call "%~dp0runtime-home.bat"
if not defined USBAI_RUNTIME (echo    [ERROR] No usable runtime. & pause & exit /b 1)
"%USBAI_RUNTIME%\node\node.exe" tools\portable-runtime.mjs stop-gateway
popd
if exist "%~dp0..\data\run\gateway.pid" echo Gateway stop failed; close the web or terminal session and retry.
if not exist "%~dp0..\data\run\gateway.pid" echo Stopped the gateway owned by this USB session.
echo.
pause
