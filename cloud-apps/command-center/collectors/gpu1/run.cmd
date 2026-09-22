@echo off
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
:loop
"%USERPROFILE%\loop-studio-cutter\venv\Scripts\python.exe" "%USERPROFILE%\.command-center\collectors\gpu1\run.py" >> "%USERPROFILE%\.command-center\logs\loop-studio.out.log" 2>> "%USERPROFILE%\.command-center\logs\loop-studio.err.log"
if errorlevel 2 if not errorlevel 3 exit /b 0
timeout /t 15 /nobreak >nul
goto loop
