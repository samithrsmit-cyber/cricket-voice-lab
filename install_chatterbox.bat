@echo off
setlocal
cd /d "%~dp0"
set "PYTHON=%~dp0..\..\work\chatterbox-env\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo The Chatterbox environment was not found.
  pause
  exit /b 1
)

echo Installing the local Chatterbox runtime.
echo PyTorch and the supporting packages are large, so this may take several minutes.
echo.
"%PYTHON%" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto failed

"%PYTHON%" -m pip install "numpy>=1.24,<2"
if errorlevel 1 goto failed

"%PYTHON%" -m pip install chatterbox-tts
if errorlevel 1 goto failed

echo.
echo Chatterbox installed successfully. Opening Cricket Voice Lab...
call "%~dp0start_voice_tester.bat"
exit /b 0

:failed
echo.
echo Installation did not finish. Keep this window open and share the final error shown above.
pause
exit /b 1
