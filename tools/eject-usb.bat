@echo off
rem ============================================================================
rem  eject-usb.bat -- kept only for backwards compatibility.
rem
rem  The old version ran a Node script right here. That had two fatal problems
rem  for this specific task, both verified with FSCTL_LOCK_VOLUME:
rem    1) this window's working directory stayed on the USB, and a cmd whose CWD
rem       sits on the drive keeps the volume locked;
rem    2) it ended with "pause", so the window -- and therefore the lock --
rem       stayed alive while the user tried to eject.
rem  The real work now lives in usb-eject.bat (stages itself into %TEMP% on the
rem  host disk, does a real volume lock + eject, and never keeps a handle on the
rem  drive). This file is a thin forwarder so old shortcuts keep working.
rem
rem  NOTE: this file must stay pure ASCII + CRLF.
rem ============================================================================
cd /d "%SystemRoot%"
call "%~dp0usb-eject.bat" %*
exit /b %ERRORLEVEL%
