@echo off
setlocal
title Pack for USB
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
echo   把整包打成单个 zip —— U 盘只需要拷这一个大文件
echo   产物默认放在包的上一级目录：usb-agent-pack.zip
echo   加参数 --runtime 只打包 runtime，--fast 不做压缩（打包最快）
echo.
echo   提示：更推荐 tools\deploy-to-usb.bat ^<盘符^>
echo         —— runtime 只在 U 盘上留一个 zip，其余多线程同步，日常几乎不用等
echo ============================================================
echo.
"%USBAI_RUNTIME%\node\node.exe" "%~dp0pack-for-usb.mjs" %*
popd
echo.
pause
