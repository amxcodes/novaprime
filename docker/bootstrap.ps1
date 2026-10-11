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

function Get-NovaPort([string]$Name, [string]$Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { $value = $Default }
  $parsed = 0
  if ($value -notmatch '^[0-9]{1,5}$' -or -not [int]::TryParse($value, [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
    throw "NOVA_PORT_INVALID: set $Name to an integer from 1 to 65535."
  }
  return $parsed
}

$postgresPort = Get-NovaPort "NOVA_POSTGRES_PORT" "5432"
$apiPort = Get-NovaPort "NOVA_API_PORT" "3001"
if ($postgresPort -eq $apiPort) { throw "NOVA_PORTS_MUST_DIFFER: choose different PostgreSQL and API host ports." }

$repoPath = (Get-Location).Path
$repoSlug = (Split-Path -Leaf $repoPath).ToLowerInvariant() -replace '[^a-z0-9_-]+', '-'
$repoSlug = $repoSlug -replace '^[^a-z0-9]+', '' -replace '-+$', ''
if ([string]::IsNullOrWhiteSpace($repoSlug)) { $repoSlug = "workspace" }
if ($repoSlug.Length -gt 32) { $repoSlug = $repoSlug.Substring(0, 32).TrimEnd('-') }
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $pathHash = [BitConverter]::ToString($sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($repoPath))).Replace("-", "").ToLowerInvariant().Substring(0, 8)
} finally { $sha256.Dispose() }
$composeProject = [Environment]::GetEnvironmentVariable("NOVA_COMPOSE_PROJECT_NAME")
if ([string]::IsNullOrWhiteSpace($composeProject)) { $composeProject = "nova-$repoSlug-$pathHash" }
if ($composeProject -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') {
  throw "NOVA_COMPOSE_PROJECT_NAME_INVALID: use 1-63 lowercase letters, digits, hyphens, or underscores; begin with a letter or digit."
}

function New-NovaSecret {
  $bytes = [byte[]]::new(32)
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  return [BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
}

function New-NovaEncryptionKey {
  $bytes = [byte[]]::new(32)
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
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
NOVA_COMPOSE_PROJECT_NAME=$composeProject
NOVA_MIGRATOR_PASSWORD=$migratorPassword
NOVA_APP_PASSWORD=$appPassword
NOVA_POSTGRES_PORT=$postgresPort
NOVA_API_PORT=$apiPort
MIGRATOR_DATABASE_URL=postgresql://nova_migrator:$migratorPassword@localhost:$postgresPort/nova
DATABASE_URL=postgresql://nova_app:$appPassword@localhost:$postgresPort/nova
NOVA_APPLICATION_DATABASE_ROLE=nova_app
BETTER_AUTH_SECRET=$authSecret
BETTER_AUTH_URL=http://localhost:$apiPort
NOVA_ALLOWED_ORIGINS=http://localhost:$apiPort
NOVA_BOOTSTRAP_TOKEN=$bootstrapToken
NOVA_SECRETS_ENCRYPTION_KEY=$encryptionKey
NOVA_BACKGROUND_JOB_SECRET=$backgroundJobSecret
"@ | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path (Get-Location) ".env"), $_, [System.Text.UTF8Encoding]::new($false)) }

docker compose --env-file .env -f docker/compose.yaml up --build -d
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $ready = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$apiPort/api/ready" -TimeoutSec 2
    if ($ready.StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Seconds 2
  if ($attempt -eq 59) { throw "NOVA_API_READY_TIMEOUT" }
}

Write-Host "NOVA is ready at http://localhost:$apiPort"
Write-Host "One-time founder setup token: $bootstrapToken"
Write-Host "Keep .env private. Configure HTTPS, BETTER_AUTH_URL, and NOVA_ALLOWED_ORIGINS before public deployment."
