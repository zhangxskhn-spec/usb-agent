@echo off
rem ============================================================================
rem  usb-eject.bat -- smart release + eject for the USB drive this pack lives on
rem
rem  Just double-click it. Or from a shell:
rem     usb-eject.bat                release the drive this file sits on
rem     usb-eject.bat E:             release drive E:
rem     usb-eject.bat E: -Check      diagnose only (kill nothing, eject nothing)
rem     usb-eject.bat E: -Force      force "mountvol /p" when the volume lock fails
rem
rem  Why it stages itself into %TEMP% and re-launches from there:
rem   1) a running .bat keeps an open handle on the drive it lives on;
rem   2) cmd.exe's working directory would stay on the USB.
rem  Both make the volume un-ejectable (verified with FSCTL_LOCK_VOLUME).
rem  So the real work must run from the host machine, not from the USB.
rem
rem  NOTE: this file must stay pure ASCII + CRLF. Non-ASCII characters in a .bat
rem  get mangled by the console code page and can break parsing (project rule).
rem ============================================================================
setlocal EnableExtensions

if /i "%~1"=="--inner" goto :inner

set "DRIVE=%~1"
if "%DRIVE%"=="" set "DRIVE=%~d0"
set "EXTRAS=%~2 %~3 %~4"

set "STAGE=%TEMP%\usb-eject-stage"
if not exist "%STAGE%" mkdir "%STAGE%" >nul 2>&1

if not exist "%~dp0usb-eject.ps1" (
  echo [ERROR] usb-eject.ps1 is missing next to this file.
  echo         Keep both files together in the pack's tools folder.
  pause
  exit /b 1
)

copy /y "%~f0" "%STAGE%\run.bat" >nul 2>&1
copy /y "%~dp0usb-eject.ps1" "%STAGE%\usb-eject.ps1" >nul 2>&1

if not exist "%STAGE%\run.bat" goto :stagefail
if not exist "%STAGE%\usb-eject.ps1" goto :stagefail

rem Move our own working directory off the USB, then hand over and get out of
rem the way so not a single handle of ours is left on the drive.
cd /d "%SystemRoot%"
start "USB Eject" "%STAGE%\run.bat" --inner "%DRIVE%" %EXTRAS%
exit /b 0

:stagefail
echo [ERROR] Could not stage the helper into %TEMP%.
echo         Copy this pack's tools folder to a local disk and run it from there.
pause
exit /b 1

:inner
rem ---- this part runs from %TEMP% (host disk), never from the USB ----
set "DRIVE=%~2"
if "%DRIVE%"=="" set "DRIVE=%~d0"
set "EXTRAS=%~3 %~4"

cd /d "%SystemRoot%"
title Release USB %DRIVE% - smart eject
echo.
echo Starting safe-eject helper for %DRIVE% ...
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0usb-eject.ps1" -Drive "%DRIVE%" %EXTRAS%
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo Done. You can unplug the drive now.
) else (
  echo Helper exited with code %RC%.
  echo If the drive still refuses, run this again as administrator: right-click
  echo run.bat in %TEMP%\usb-eject-stage and pick "Run as administrator",
  echo or add -Force to force the drive offline.
)
echo.
echo Press any key to close this window.
pause >nul
exit /b %RC%
