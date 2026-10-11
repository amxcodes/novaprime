#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ -e .env ]]; then
  echo ".env already exists. Keep it and use the normal upgrade command, or remove it only after backing it up." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "Install Docker Engine first." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose is required." >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is required to generate local secrets." >&2; exit 1; }

postgres_port="${NOVA_POSTGRES_PORT:-5432}"
api_port="${NOVA_API_PORT:-3001}"
repo_slug="$(basename "$(pwd -P)" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^[^a-z0-9]+//; s/-+$//' | cut -c 1-32)"
repo_slug="${repo_slug:-workspace}"
path_hash="$(printf '%s' "$(pwd -P)" | openssl dgst -sha256 | awk '{print substr($NF, 1, 8)}')"
compose_project="${NOVA_COMPOSE_PROJECT_NAME:-nova-${repo_slug}-${path_hash}}"
for port in "$postgres_port" "$api_port"; do
  [[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || {
    echo "NOVA_PORT_INVALID: choose an integer from 1 to 65535 for NOVA_POSTGRES_PORT and NOVA_API_PORT." >&2
    exit 1
  }
done
[[ "$postgres_port" != "$api_port" ]] || { echo "NOVA_PORTS_MUST_DIFFER: choose different PostgreSQL and API host ports." >&2; exit 1; }
[[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || {
  echo "NOVA_COMPOSE_PROJECT_NAME_INVALID: use 1-63 lowercase letters, digits, hyphens, or underscores; begin with a letter or digit." >&2
  exit 1
}

new_secret() { openssl rand -hex 32; }
new_encryption_key() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }
migrator_password="$(new_secret)"
app_password="$(new_secret)"
auth_secret="$(new_secret)"
bootstrap_token="$(new_secret)"
encryption_key="$(new_encryption_key)"
background_job_secret="$(new_secret)"
[[ "$encryption_key" =~ ^[A-Za-z0-9_-]{43}$ ]] || { echo "NOVA_ENCRYPTION_KEY_GENERATION_FAILED" >&2; exit 1; }

umask 077
cat > .env <<EOF
NOVA_COMPOSE_PROJECT_NAME=$compose_project
NOVA_MIGRATOR_PASSWORD=$migrator_password
NOVA_APP_PASSWORD=$app_password
NOVA_POSTGRES_PORT=$postgres_port
NOVA_API_PORT=$api_port
MIGRATOR_DATABASE_URL=postgresql://nova_migrator:$migrator_password@localhost:$postgres_port/nova
DATABASE_URL=postgresql://nova_app:$app_password@localhost:$postgres_port/nova
NOVA_APPLICATION_DATABASE_ROLE=nova_app
BETTER_AUTH_SECRET=$auth_secret
BETTER_AUTH_URL=http://localhost:$api_port
NOVA_ALLOWED_ORIGINS=http://localhost:$api_port
NOVA_BOOTSTRAP_TOKEN=$bootstrap_token
NOVA_SECRETS_ENCRYPTION_KEY=$encryption_key
NOVA_BACKGROUND_JOB_SECRET=$background_job_secret
EOF

docker compose --env-file .env -f docker/compose.yaml up --build -d
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "http://localhost:$api_port/api/ready" >/dev/null; then
    echo "NOVA is ready at http://localhost:$api_port"
    echo "One-time founder setup token: $bootstrap_token"
    echo "Keep .env private. Configure HTTPS, BETTER_AUTH_URL, and NOVA_ALLOWED_ORIGINS before public deployment."
    exit 0
  fi
  sleep 2
done
echo "NOVA_API_READY_TIMEOUT" >&2
exit 1
