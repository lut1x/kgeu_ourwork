$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskEnvFile = Join-Path $taskRoot '.env.local'
$taskEmail = (Read-Host 'Адрес Gmail для отправки кодов').Trim().ToLower()
if ($taskEmail -notmatch '^[a-z0-9._%+-]+@gmail\.com$') { throw 'Введите полный адрес Gmail' }
$taskSecret = Read-Host 'Пароль приложения Google (не обычный пароль)' -AsSecureString
$taskPassword = [System.Net.NetworkCredential]::new('', $taskSecret).Password.Replace(' ', '')
if ($taskPassword -notmatch '^[a-zA-Z0-9]{16}$') { throw 'Ожидается 16-символьный пароль приложения Google' }
$taskChanges = @{ MAIL_MODE='smtp'; SMTP_HOST='smtp.gmail.com'; SMTP_PORT='465'; SMTP_USER=$taskEmail; SMTP_PASSWORD=$taskPassword; MAIL_FROM="Tech SCADA <$taskEmail>"; APP_URL='http://localhost' }
$taskLines = @(Get-Content -LiteralPath $taskEnvFile | Where-Object { $taskName = ($_ -split '=',2)[0]; -not $taskChanges.ContainsKey($taskName) })
foreach ($taskName in $taskChanges.Keys) { $taskLines += "$taskName=$($taskChanges[$taskName])" }
Set-Content -LiteralPath $taskEnvFile -Value $taskLines
$taskPassword = $null; $taskChanges = $null; $taskLines = $null
$taskDocker = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
if (-not (Test-Path -LiteralPath $taskDocker)) { $taskDocker = 'docker' }
Push-Location $taskRoot
try {
  & $taskDocker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml up -d backend
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось применить настройки Docker' }
  & $taskDocker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml exec -T backend node smtp-check.js
  if ($LASTEXITCODE -ne 0) { throw 'SMTP-проверка не прошла. Проверьте пароль приложения и доступ к Gmail' }
  & $taskDocker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml restart frontend
  Write-Host 'Gmail подключен. Коды регистрации будут отправляться на реальные адреса.'
} finally { Pop-Location }
