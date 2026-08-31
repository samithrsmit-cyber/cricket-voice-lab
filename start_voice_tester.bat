@echo off
setlocal
cd /d "%~dp0"
set "PYTHON=%~dp0..\..\work\chatterbox-env\Scripts\python.exe"
set "SERVER=%~dp0server.py"
set "HF_HOME=%~dp0..\..\work\huggingface-cache"
set "PKUSEG_HOME=%~dp0..\..\work\huggingface-cache\pkuseg"
set "TORCH_HOME=%~dp0..\..\work\huggingface-cache\torch"
set "XDG_CACHE_HOME=%~dp0..\..\work\huggingface-cache"
set "NUMBA_CACHE_DIR=%~dp0..\..\work\huggingface-cache\numba"
set "MPLCONFIGDIR=%~dp0..\..\work\huggingface-cache\matplotlib"

if not exist "%PYTHON%" (
  echo Cricket Voice Lab could not find its Python environment.
  pause
  exit /b 1
)

echo Closing old Cricket Voice Lab test servers...
for %%P in (8765 8766 8767 8768 8769 8770 8771) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do taskkill /PID %%A /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

start "Cricket Voice Lab Server" /min "%PYTHON%" -u "%SERVER%"

for /l %%N in (1,1,15) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8771/api/status; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo Cricket Voice Lab could not start. Keep this window open and share this message.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:8771"
exit /b 0
