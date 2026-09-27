$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)
if (Test-Path -LiteralPath ".env") {
  throw ".env already exists. Keep it and use the normal upgrade command, or remove it only after backing it up."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "WINDOWS_DOCKER_CLI_REQUIRED: Install Docker Desktop, or run 'bash docker/bootstrap.sh' from an interactive WSL shell when Docker Engine exists only inside WSL. Keep that WSL shell open while using NOVA from Windows."
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw "DOCKER_COMPOSE_V2_REQUIRED: Install Docker Compose v2." }
docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) { throw "DOCKER_ENGINE_NOT_RUNNING: Start Docker Desktop and retry." }

function New-NovaSecret {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return ([Convert]::ToHexString($bytes)).ToLowerInvariant()
}

function New-NovaEncryptionKey {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$migratorPassword = New-NovaSecret
$appPassword = New-NovaSecret
$authSecret = New-NovaSecret
$bootstrapToken = New-NovaSecret
$encryptionKey = New-NovaEncryptionKey
$backgroundJobSecret = New-NovaSecret
if ($encryptionKey -notmatch '^[A-Za-z0-9_-]{43}$') { throw "NOVA_ENCRYPTION_KEY_GENERATION_FAILED" }

@"
NOVA_MIGRATOR_PASSWORD=$migratorPassword
NOVA_APP_PASSWORD=$appPassword
NOVA_POSTGRES_PORT=5432
NOVA_API_PORT=3001
MIGRATOR_DATABASE_URL=postgresql://nova_migrator:$migratorPassword@localhost:5432/nova
DATABASE_URL=postgresql://nova_app:$appPassword@localhost:5432/nova
NOVA_APPLICATION_DATABASE_ROLE=nova_app
BETTER_AUTH_SECRET=$authSecret
BETTER_AUTH_URL=http://localhost:3001
NOVA_ALLOWED_ORIGINS=http://localhost:3001
NOVA_BOOTSTRAP_TOKEN=$bootstrapToken
NOVA_SECRETS_ENCRYPTION_KEY=$encryptionKey
NOVA_BACKGROUND_JOB_SECRET=$backgroundJobSecret
"@ | Set-Content -LiteralPath ".env" -Encoding utf8 -NoNewline

docker compose --env-file .env -f docker/compose.yaml up --build -d
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $ready = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3001/api/ready" -TimeoutSec 2
    if ($ready.StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Seconds 2
  if ($attempt -eq 59) { throw "NOVA_API_READY_TIMEOUT" }
}

Write-Host "NOVA is ready at http://localhost:3001"
Write-Host "One-time founder setup token: $bootstrapToken"
Write-Host "Keep .env private. Configure HTTPS, BETTER_AUTH_URL, and NOVA_ALLOWED_ORIGINS before public deployment."
