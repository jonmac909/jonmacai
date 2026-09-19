@echo off
start "" /B cmd /c "%~dp0run.cmd"
"C:\Users\partn\AppData\Local\Programs\Python\Python312\python.exe" "%USERPROFILE%\.command-center\collectors\gpu2\collect.py"
