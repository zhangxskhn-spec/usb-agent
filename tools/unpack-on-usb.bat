@echo off
setlocal EnableExtensions
title Unpack on USB drive
set "ZIP=%~1"
if "%ZIP%"=="" set /p ZIP=请输入 zip 的完整路径（例如 E:\usb-agent-pack.zip）: 
if not exist "%ZIP%" (
  echo [ERROR] 找不到文件：%ZIP%
  pause
  exit /b 1
)
set "DEST=%~2"
if "%DEST%"=="" for %%I in ("%ZIP%") do set "DEST=%%~dpI"
if "%DEST:~-1%"=="\" set "DEST=%DEST:~0,-1%"
if "%DEST:~-1%"==":" set "DEST=%DEST%\"
echo.
echo 解压 %ZIP%
echo   到   %DEST%
echo.
set "TAR=%SystemRoot%\System32\tar.exe"
if exist "%TAR%" goto :use_tar
echo 本机没有 tar.exe，改用 PowerShell 解压（会慢一些）...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%DEST%' -Force"
goto :done

:use_tar
"%TAR%" -x -f "%ZIP%" -C "%DEST%"
if errorlevel 1 goto :failed

:done
echo.
echo 完成。现在可以双击 START.bat 启动（首次启动会稍慢）。
pause
exit /b 0

:failed
echo.
echo [WARN] 解压过程中出错：请确认 U 盘剩余空间足够（runtime 解开后约 1.6 GB）。
pause
exit /b 1
