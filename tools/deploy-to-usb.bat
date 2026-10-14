@echo off
setlocal
title Deploy to USB drive
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
echo   把包部署到 U 盘（推荐方式）
echo     - runtime 在 U 盘上只留 runtime.zip 一个文件（顺序写，不受碎文件拖累）
echo     - 其余文件用 robocopy /MT:32 多线程同步；data 只补新增
echo     - 目标机上首次启动时把 runtime 展开到本机一次，之后秒开
echo.
echo   用法： deploy-to-usb.bat E           ^<-- 只填盘符即可
echo          deploy-to-usb.bat E --skip-runtime   只同步程序与 data（改了代码后快速更新）
echo          deploy-to-usb.bat E --inline         老布局（runtime 目录也拷，慢）
echo ============================================================
echo.
"%USBAI_RUNTIME%\node\node.exe" "%~dp0deploy-to-usb.mjs" %*
popd
echo.
pause
