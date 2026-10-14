@echo off
setlocal
title Sync to USB drive
pushd "%~dp0.."
call "%~dp0runtime-home.bat"
if not defined USBAI_RUNTIME (
  echo [ERROR] No usable runtime found.
  popd
  pause
  exit /b 1
)
echo.
echo ============================================================
echo   快速同步：只同步程序文件与 data，不动 U 盘上的 runtime
echo   （改了前端补丁/脚本后用这个，几秒钟完事）
echo   用法： sync-to-usb.bat E
echo ============================================================
echo.
"%USBAI_RUNTIME%\node\node.exe" "%~dp0deploy-to-usb.mjs" %* --skip-runtime
popd
echo.
pause
