@echo off
setlocal
set "REPAIR_SCRIPT=%~dp0repair_voice_lab.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%REPAIR_SCRIPT%""'"
exit /b 0
