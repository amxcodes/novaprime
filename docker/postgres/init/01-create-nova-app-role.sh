#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=application_password="$NOVA_APP_PASSWORD" <<'SQL'
CREATE ROLE nova_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  PASSWORD :'application_password';
SQL
