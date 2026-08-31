@echo off
setlocal
cd /d "%~dp0"

set "PYTHON=%USERPROFILE%\Documents\Codex\2026-08-24\hay\outputs\cricket-stats-rag\.venv\Scripts\python.exe"
set "MODEL=%USERPROFILE%\Documents\Codex\2026-08-24\hay\outputs\cricket-stats-rag\models\qwen2.5-3b-instruct-q4_k_m.gguf"
set "SERVER=%~dp0server.py"
set "CRICKET_LLM_MODEL=%MODEL%"

if not exist "%PYTHON%" (
  echo The existing Qwen Python environment was not found:
  echo %PYTHON%
  pause
  exit /b 1
)

if not exist "%MODEL%" (
  echo The existing Qwen model was not found:
  echo %MODEL%
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -TimeoutSec 2 http://127.0.0.1:8772/api/shutdown | Out-Null } catch {}" >nul 2>&1
timeout /t 2 /nobreak >nul

start "Continuous Cricket Commentary" /min "%PYTHON%" -u "%SERVER%"

for /l %%N in (1,1,90) do (
  powershell -NoProfile -Command "try { $r = Invoke-RestMethod -TimeoutSec 2 http://127.0.0.1:8772/api/status; if ($r.ready) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo The local Qwen model did not become ready.
echo Keep this window open and share the server message.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:8772"
exit /b 0
