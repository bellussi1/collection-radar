# Registra a varredura, o digest diário, a varredura semanal de ISBN e o backup
# diário no Task Scheduler do Windows.
# Rode no PowerShell do seu usuário. Se falhar por permissão, abra como administrador.
# A varredura usa LogonType Interactive: o Chromium precisa de uma sessão de desktop
# para passar pelo Cloudflare da OLX e do Mercado Livre. O digest usa o mesmo
# contexto para ler o banco local e enviar o e-mail. A AbeBooks também usa o
# Chromium para consultar os ISBNs.

$ErrorActionPreference = "Stop"

$repo = "C:\Users\Bellussi\Documents\Workspace\collection-radar"

$scanAction = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$repo\scripts\scan.cmd`"" `
  -WorkingDirectory $repo

$scanStart = (Get-Date).Date.AddHours(7)
if ($scanStart -le (Get-Date)) {
  $scanStart = $scanStart.AddDays(1)
}
$scanTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At $scanStart `
  -RepetitionInterval (New-TimeSpan -Hours 6)

$digestAction = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$repo\scripts\digest.cmd`"" `
  -WorkingDirectory $repo

$digestStart = (Get-Date).Date.AddHours(9)
if ($digestStart -le (Get-Date)) {
  $digestStart = $digestStart.AddDays(1)
}
$digestTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At $digestStart `
  -RepetitionInterval (New-TimeSpan -Days 1)

$isbnAction = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$repo\scripts\isbn-scan.cmd`"" `
  -WorkingDirectory $repo

$daysUntilMonday = (8 - [int](Get-Date).DayOfWeek) % 7
$isbnStart = (Get-Date).Date.AddDays($daysUntilMonday).AddHours(8)
if ($isbnStart -le (Get-Date)) {
  $isbnStart = $isbnStart.AddDays(7)
}
$isbnTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At $isbnStart `
  -RepetitionInterval (New-TimeSpan -Days 7)

$sebosAction = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$repo\scripts\sebos-scan.cmd`"" `
  -WorkingDirectory $repo

$sebosStart = (Get-Date).Date.AddHours(8).AddMinutes(30)
if ($sebosStart -le (Get-Date)) {
  $sebosStart = $sebosStart.AddDays(1)
}
$sebosTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At $sebosStart `
  -RepetitionInterval (New-TimeSpan -Days 1)

$backupAction = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$repo\scripts\backup.cmd`"" `
  -WorkingDirectory $repo

$backupStart = (Get-Date).Date.AddHours(9).AddMinutes(30)
if ($backupStart -le (Get-Date)) {
  $backupStart = $backupStart.AddDays(1)
}
$backupTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At $backupStart `
  -RepetitionInterval (New-TimeSpan -Days 1)

$principal = New-ScheduledTaskPrincipal `
  -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Limited

$scanSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$digestSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$isbnSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$sebosSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$backupSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
  -TaskName "Collection Radar" `
  -Action $scanAction `
  -Trigger $scanTrigger `
  -Principal $principal `
  -Settings $scanSettings `
  -Description "Radar local de livros usados e importados (scan sem e-mail)" `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName "Collection Radar Digest" `
  -Action $digestAction `
  -Trigger $digestTrigger `
  -Principal $principal `
  -Settings $digestSettings `
  -Description "Digest diário do Collection Radar" `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName "Collection Radar ISBN" `
  -Action $isbnAction `
  -Trigger $isbnTrigger `
  -Principal $principal `
  -Settings $isbnSettings `
  -Description "Varredura semanal da AbeBooks por ISBN" `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName "Collection Radar Sebos" `
  -Action $sebosAction `
  -Trigger $sebosTrigger `
  -Principal $principal `
  -Settings $sebosSettings `
  -Description "Sebos independentes via Google Programmable Search" `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName "Collection Radar Backup" `
  -Action $backupAction `
  -Trigger $backupTrigger `
  -Principal $principal `
  -Settings $backupSettings `
  -Description "Backup diário do SQLite do Collection Radar" `
  -Force | Out-Null

Write-Host "Tarefa 'Collection Radar': varredura a cada 6 horas, sem e-mail."
Write-Host "Tarefa 'Collection Radar Digest': todos os dias às 09:00."
Write-Host "Tarefa 'Collection Radar ISBN': toda segunda-feira às 08:00."
Write-Host "Tarefa 'Collection Radar Sebos': todos os dias às 08:30."
Write-Host "Tarefa 'Collection Radar Backup': todos os dias às 09:30."
Write-Host "Primeira varredura: $($scanStart.ToString('dd/MM/yyyy HH:mm'))."
Write-Host "Primeiro digest: $($digestStart.ToString('dd/MM/yyyy HH:mm'))."
Write-Host "Primeira varredura de ISBN: $($isbnStart.ToString('dd/MM/yyyy HH:mm'))."
Write-Host "Primeira varredura de sebos: $($sebosStart.ToString('dd/MM/yyyy HH:mm'))."
Write-Host "Primeiro backup: $($backupStart.ToString('dd/MM/yyyy HH:mm'))."
