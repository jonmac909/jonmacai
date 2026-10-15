# Registers the hidden 60 s machine heartbeat on GPU1. Safe to re-run.
$py = "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe"
$vbs = "$env:USERPROFILE\.command-center\collectors\gpu1\run_hidden.vbs"
$beat = "$env:USERPROFILE\.command-center\collectors\gpu1\beat.py"
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`" `"$py`" `"$beat`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(30) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'CommandCenterMachineBeat' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
"registered"
