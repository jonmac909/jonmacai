' Runs a command with no visible window (so scheduled tasks don't steal focus from games).
' Usage: wscript.exe run_hidden.vbs "<exe>" [args...]
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & """" & WScript.Arguments(i) & """ "
Next
sh.Run Trim(cmd), 0, True
