@echo off
rem ============================================================
rem  runtime-home.bat —— 解析「本机可用的 runtime 目录」，必要时把 runtime.zip 展开到本机
rem
rem  支持两种布局：
rem    A) 就地布局：包里直接有 runtime\ 目录（开发副本、老 U 盘）
rem    B) 瘦身布局：包里只有 runtime.zip + runtime.sha256 两个文件
rem       —— 首次运行展开到本机磁盘一次，之后秒用。这样 U 盘上永远只有一个 runtime 文件，
rem          拷贝 U 盘与文件数无关（FAT32 上尤其致命），运行时也从本机 SSD 读，更快。
rem
rem  用法：call "%~dp0runtime-home.bat"   调用后 %USBAI_RUNTIME% 即可用目录（失败为空）
rem ============================================================
setlocal EnableExtensions
set "RHB_ROOT=%~dp0.."
for %%I in ("%RHB_ROOT%") do set "RHB_ROOT=%%~fI"

rem ---------- A) 就地布局 ----------
if exist "%RHB_ROOT%\runtime\node\node.exe" (
  endlocal & set "USBAI_RUNTIME=%RHB_ROOT%\runtime"
  exit /b 0
)

rem ---------- B) 瘦身布局 ----------
if not exist "%RHB_ROOT%\runtime.zip" (
  echo [runtime] 既没有 runtime\ 目录，也没有 runtime.zip。
  endlocal & set "USBAI_RUNTIME="
  exit /b 1
)

rem 缓存必须落在「真机的本机磁盘」上：START.bat 会把 USERPROFILE/LOCALAPPDATA 指到 U 盘，
rem 所以优先用 AI_REAL_USERPROFILE（START.bat 提前存好的真机用户目录）。
set "RHB_LOCAL="
if defined AI_REAL_USERPROFILE set "RHB_LOCAL=%AI_REAL_USERPROFILE%\AppData\Local"
if not defined RHB_LOCAL if defined USERPROFILE set "RHB_LOCAL=%USERPROFILE%\AppData\Local"
if not defined RHB_LOCAL set "RHB_LOCAL=%SystemDrive%\Users\Public"
rem 兜底：万一算出来的位置还在包目录里（U 盘），改用公共目录，别把缓存写回 U 盘
set "RHB_SUB="
call set "RHB_SUB=%%RHB_LOCAL:%RHB_ROOT%=%%"
if not "%RHB_SUB%"=="%RHB_LOCAL%" set "RHB_LOCAL=%SystemDrive%\Users\Public"

set "RHB_KEY=default"
set "RHB_RAW="
if exist "%RHB_ROOT%\runtime.sha256" for /f "usebackq delims=" %%k in ("%RHB_ROOT%\runtime.sha256") do if not defined RHB_RAW set "RHB_RAW=%%k"
if defined RHB_RAW set "RHB_KEY=%RHB_RAW:~0,32%"
set "RHB_CACHE=%RHB_LOCAL%\usb-agent-runtime\%RHB_KEY%"

if exist "%RHB_CACHE%\node\node.exe" goto :rhb_ready

echo.
echo ============================================================
echo   首次在本机使用：正在把 runtime 展开到本机磁盘
echo   （只做这一次，之后启动秒开；U 盘上始终只保留 runtime.zip）
echo   目标：%RHB_CACHE%
echo ============================================================
echo.

if not exist "%SystemRoot%\System32\tar.exe" goto :rhb_notar
if exist "%RHB_CACHE%.part" rd /s /q "%RHB_CACHE%.part" >nul 2>&1
mkdir "%RHB_CACHE%.part" >nul 2>&1
"%SystemRoot%\System32\tar.exe" -x -f "%RHB_ROOT%\runtime.zip" -C "%RHB_CACHE%.part"
if errorlevel 1 goto :rhb_fail
if not exist "%RHB_CACHE%.part\node\node.exe" goto :rhb_fail
mkdir "%RHB_LOCAL%\usb-agent-runtime" >nul 2>&1
if exist "%RHB_CACHE%" rd /s /q "%RHB_CACHE%" >nul 2>&1
move "%RHB_CACHE%.part" "%RHB_CACHE%" >nul
if not exist "%RHB_CACHE%\node\node.exe" goto :rhb_fail
echo [runtime] 展开完成。
echo.

:rhb_ready
endlocal & set "USBAI_RUNTIME=%RHB_CACHE%"
exit /b 0

:rhb_notar
echo [runtime] 本机没有 %SystemRoot%\System32\tar.exe（Win10 1803 以下），无法展开。
echo           请改用「就地布局」：把 runtime 目录直接放到 U 盘包里。
endlocal & set "USBAI_RUNTIME="
exit /b 1

:rhb_fail
echo [runtime] 展开失败：请确认本机磁盘剩余空间大于 2 GB，且 U 盘上的 runtime.zip 完整。
if exist "%RHB_CACHE%.part" rd /s /q "%RHB_CACHE%.part" >nul 2>&1
endlocal & set "USBAI_RUNTIME="
exit /b 1
