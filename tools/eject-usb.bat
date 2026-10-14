@echo off
setlocal
title Release USB Drive
pushd "%~dp0.."
call "%~dp0runtime-home.bat"
if not defined USBAI_RUNTIME (
  echo [ERROR] No usable runtime found - cannot scan for running processes.
  popd
  pause
  exit /b 1
)
echo.
echo ============================================================
echo   释放 U 盘：结束本包拉起的全部进程
echo   （模型网关 / 网页壳 / Claude Code / 本会话浏览器）
echo   --check 只看谁在占用，不动手
echo ============================================================
echo.
"%USBAI_RUNTIME%\node\node.exe" "%~dp0release-usb.mjs" %*
popd
echo.
pause
