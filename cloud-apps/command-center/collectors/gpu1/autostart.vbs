Set sh = CreateObject("WScript.Shell")
cmd = sh.ExpandEnvironmentStrings("%USERPROFILE%\.command-center\collectors\gpu1\run.cmd")
sh.Run "cmd /c """ & cmd & """", 0, False
