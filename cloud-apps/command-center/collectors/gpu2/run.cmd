@echo off
if not exist "%USERPROFILE%\.command-center\logs" mkdir "%USERPROFILE%\.command-center\logs"
:loop
"C:\Users\partn\AppData\Local\Programs\Python\Python312\python.exe" "%USERPROFILE%\.command-center\collectors\gpu2\run.py" >> "%USERPROFILE%\.command-center\logs\run.out.log" 2>> "%USERPROFILE%\.command-center\logs\run.err.log"
if errorlevel 2 if not errorlevel 3 exit /b 0
timeout /t 10 /nobreak >nul
goto loop
