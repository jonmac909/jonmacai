@echo off
rem Loop Studio GPU1 collector loop (fixed 2026-10-05).
rem - exits when another claimer holds the lock (exit 2) or when python cannot start
rem - backs off on failures and gives up after 10 in a row; the scheduled task
rem   (guarded in autostart.vbs) restarts it later. It can never loop forever.
set PYTHONUNBUFFERED=1
if not exist "%USERPROFILE%\.command-center\logs" mkdir "%USERPROFILE%\.command-center\logs"
set CC_SECRETS=%USERPROFILE%\.command-center\gpu1-loop.env
set LS_CUTTER=%USERPROFILE%\loop-studio-cutter\core\engine\cut\cut.py
set LS_JOB_ROOT=%USERPROFILE%\loop-studio-jobs
set LS_DEVICE=cpu
set LS_WHISPER_DEVICE=cpu
set CUDA_VISIBLE_DEVICES=
set HF_HOME=%USERPROFILE%\loop-studio-cutter\hf
set TORCH_HOME=%USERPROFILE%\loop-studio-cutter\torch
set PYTHONPATH=%USERPROFILE%\loop-studio-cutter\core\engine
set PATH=C:\Windows\System32;C:\Windows;C:\FFmpeg\bin;%USERPROFILE%\loop-studio-cutter\venv\Scripts
set FAILS=0
:loop
"%USERPROFILE%\loop-studio-cutter\venv\Scripts\python.exe" "%USERPROFILE%\.command-center\collectors\gpu1\run.py" >> "%USERPROFILE%\.command-center\logs\loop-studio.out.log" 2>> "%USERPROFILE%\.command-center\logs\loop-studio.err.log"
set RC=%ERRORLEVEL%
if "%RC%"=="0" exit /b 0
if "%RC%"=="2" exit /b 0
if %RC% LSS 0 (
  echo %DATE% %TIME% run.cmd: python failed to start rc=%RC%, exiting>> "%USERPROFILE%\.command-center\logs\loop-studio.err.log"
  exit /b 1
)
set /a FAILS+=1
if %FAILS% GEQ 10 (
  echo %DATE% %TIME% run.cmd: %FAILS% failures in a row, exiting>> "%USERPROFILE%\.command-center\logs\loop-studio.err.log"
  exit /b 1
)
rem back off 30 s per failure, max 5 min
set /a WAIT=FAILS*30
if %WAIT% GTR 300 set WAIT=300
timeout /t %WAIT% /nobreak >nul 2>&1 || ping -n %WAIT% 127.0.0.1 >nul
goto loop
