# Registra a varredura no Task Scheduler do Windows.
# Rode no PowerShell do seu usuário. Se falhar por permissão, abra como administrador.
# A tarefa usa LogonType Interactive: o Chromium precisa de uma sessão de desktop
# para passar pelo Cloudflare da OLX e do Mercado Livre.

$repo = "C:\Users\Bellussi\Documents\Workspace\collection-radar"
$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$repo\scripts\scan.cmd`"" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(5) `
  -RepetitionInterval (New-TimeSpan -Hours 6)

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
  -TaskName "Collection Radar" `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Radar local de livros usados e importados" `
  -Force

Write-Host "Tarefa 'Collection Radar' registrada. Próxima execução em ~5 minutos, depois a cada 6 horas."
