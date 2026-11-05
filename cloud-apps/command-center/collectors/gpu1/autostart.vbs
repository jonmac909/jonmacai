' Loop Studio GPU1 collector launcher (fixed 2026-10-05: single-instance guard).
' Runs from the LoopStudioGPU1 scheduled task. Exits at once if a collector loop
' (run.cmd) or the claimer (run.py) is already running, so copies can never pile up.
On Error Resume Next
Set sh = CreateObject("WScript.Shell")
Set wmi = GetObject("winmgmts:\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE Name='cmd.exe' OR Name='python.exe'")
For Each p In procs
  c = LCase(p.CommandLine & "")
  If InStr(c, "collectors\gpu1\run.cmd") > 0 Or InStr(c, "collectors\gpu1\run.py") > 0 Then WScript.Quit 0
Next
Err.Clear
cmd = sh.ExpandEnvironmentStrings("%USERPROFILE%\.command-center\collectors\gpu1\run.cmd")
sh.Run "cmd /c """ & cmd & """", 0, False
