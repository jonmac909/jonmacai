@echo off
if not exist "%USERPROFILE%\.command-center\logs" mkdir "%USERPROFILE%\.command-center\logs"
start "" /B cmd /c "%~dp0run.cmd"
"C:\Users\partn\AppData\Local\Programs\Python\Python312\python.exe" "%USERPROFILE%\.command-center\collectors\gpu2\collect.py" >> "%USERPROFILE%\.command-center\logs\collect.out.log" 2>> "%USERPROFILE%\.command-center\logs\collect.err.log"
