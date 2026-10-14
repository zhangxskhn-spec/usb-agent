@echo off
setlocal EnableExtensions
title Forget local runtime cache
set "LOCALBASE="
if defined AI_REAL_USERPROFILE set "LOCALBASE=%AI_REAL_USERPROFILE%\AppData\Local"
if not defined LOCALBASE if defined USERPROFILE set "LOCALBASE=%USERPROFILE%\AppData\Local"
if not defined LOCALBASE set "LOCALBASE=%SystemDrive%\Users\Public"
set "CACHE=%LOCALBASE%\usb-agent-runtime"
echo ============================================================
echo   删除本机上的 runtime 缓存（瘦身布局首次启动时展开的那份）
echo   路径：%CACHE%
echo   删掉不影响 U 盘上的数据，下次启动会重新展开（约 1~3 分钟）。
echo ============================================================
echo.
if not exist "%CACHE%" (
  echo 没有找到缓存目录，无需清理。
  pause
  exit /b 0
)
choice /c YN /n /m "确认删除？(Y/N) "
if errorlevel 2 (
  echo 已取消。
  pause
  exit /b 0
)
rd /s /q "%CACHE%"
if exist "%CACHE%" (echo [WARN] 未完全删除：可能有进程正在用，请关掉程序后重试。) else (echo 已删除。)
pause
