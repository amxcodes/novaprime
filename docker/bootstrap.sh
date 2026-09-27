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
NOVA_MIGRATOR_PASSWORD=$migrator_password
NOVA_APP_PASSWORD=$app_password
NOVA_POSTGRES_PORT=5432
NOVA_API_PORT=3001
MIGRATOR_DATABASE_URL=postgresql://nova_migrator:$migrator_password@localhost:5432/nova
DATABASE_URL=postgresql://nova_app:$app_password@localhost:5432/nova
NOVA_APPLICATION_DATABASE_ROLE=nova_app
BETTER_AUTH_SECRET=$auth_secret
BETTER_AUTH_URL=http://localhost:3001
NOVA_ALLOWED_ORIGINS=http://localhost:3001
NOVA_BOOTSTRAP_TOKEN=$bootstrap_token
NOVA_SECRETS_ENCRYPTION_KEY=$encryption_key
NOVA_BACKGROUND_JOB_SECRET=$background_job_secret
EOF

docker compose --env-file .env -f docker/compose.yaml up --build -d
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error http://localhost:3001/api/ready >/dev/null; then
    echo "NOVA is ready at http://localhost:3001"
    echo "One-time founder setup token: $bootstrap_token"
    echo "Keep .env private. Configure HTTPS, BETTER_AUTH_URL, and NOVA_ALLOWED_ORIGINS before public deployment."
    exit 0
  fi
  sleep 2
done
echo "NOVA_API_READY_TIMEOUT" >&2
exit 1
