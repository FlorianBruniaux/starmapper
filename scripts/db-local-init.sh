#!/usr/bin/env bash
# db-local-init.sh
#
# Start a local Postgres Docker container for StarMapper batch scanning.
# Reads LOCAL_DATABASE_URL from .env.local (or falls back to default).
#
# Usage:
#   ./scripts/db-local-init.sh                          # start DB + push schema
#   NEON_URL="postgresql://..." ./scripts/db-local-init.sh --copy-geocache
#
# Requires: docker or podman, psql (brew install postgresql), npx

set -a
# Load .env.local if it exists
if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  source .env.local
fi
set +a

# Local DB config — separate from production DATABASE_URL
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://starmapper:starmapper@localhost:5433/starmapper}"

DB_PASSWORD=$(echo "$LOCAL_DATABASE_URL" | awk -F':' '{print $3}' | awk -F'@' '{print $1}')
DB_PORT=$(echo "$LOCAL_DATABASE_URL" | awk -F':' '{print $4}' | awk -F'/' '{print $1}')
DB_NAME=$(echo "$LOCAL_DATABASE_URL" | awk -F'/' '{print $4}')
DB_CONTAINER_NAME="$DB_NAME-postgres"

# ── Docker / Podman check ─────────────────────────────────────────────────────

if ! [ -x "$(command -v docker)" ] && ! [ -x "$(command -v podman)" ]; then
  echo "Docker or Podman is not installed."
  echo "Docker install: https://docs.docker.com/engine/install/"
  exit 1
fi

if [ -x "$(command -v docker)" ]; then
  DOCKER_CMD="docker"
elif [ -x "$(command -v podman)" ]; then
  DOCKER_CMD="podman"
fi

if ! $DOCKER_CMD info > /dev/null 2>&1; then
  echo "$DOCKER_CMD daemon is not running. Please start $DOCKER_CMD and try again."
  exit 1
fi

# ── Port check ────────────────────────────────────────────────────────────────

if command -v nc >/dev/null 2>&1; then
  if nc -z localhost "$DB_PORT" 2>/dev/null; then
    # Port in use — check if it's our container already running
    if [ "$($DOCKER_CMD ps -q -f name="$DB_CONTAINER_NAME")" ]; then
      echo "Container '$DB_CONTAINER_NAME' already running on port $DB_PORT."
    else
      echo "Port $DB_PORT is already in use by another process."
      exit 1
    fi
  fi
fi

# ── Container lifecycle ───────────────────────────────────────────────────────

if [ "$($DOCKER_CMD ps -q -f name="$DB_CONTAINER_NAME")" ]; then
  echo "Database container '$DB_CONTAINER_NAME' already running."
elif [ "$($DOCKER_CMD ps -q -a -f name="$DB_CONTAINER_NAME")" ]; then
  $DOCKER_CMD start "$DB_CONTAINER_NAME"
  echo "Existing database container '$DB_CONTAINER_NAME' started."
else
  $DOCKER_CMD run -d \
    --name "$DB_CONTAINER_NAME" \
    -e POSTGRES_USER="starmapper" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    -p "$DB_PORT":5432 \
    postgres:16-alpine \
    && echo "Database container '$DB_CONTAINER_NAME' created."
fi

# ── Wait for Postgres to be ready ─────────────────────────────────────────────

echo "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if $DOCKER_CMD exec "$DB_CONTAINER_NAME" pg_isready -U starmapper -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Postgres did not become ready in time."
    exit 1
  fi
  sleep 1
done

# ── Push Prisma schema ────────────────────────────────────────────────────────

echo "Pushing Prisma schema..."
DATABASE_URL="$LOCAL_DATABASE_URL" npx prisma db push

echo ""
echo "Local DB ready: $LOCAL_DATABASE_URL"

# ── Optional: copy geocache from Neon ────────────────────────────────────────

if [[ "${1:-}" == "--copy-geocache" ]]; then
  NEON_URL="${NEON_URL:-${DATABASE_URL:-}}"
  if [[ -z "$NEON_URL" ]] || [[ "$NEON_URL" == "$LOCAL_DATABASE_URL" ]]; then
    echo ""
    echo "Error: NEON_URL not set (or same as local). Export it first:"
    echo "  export NEON_URL=\$(grep DATABASE_URL .env.local | cut -d= -f2-)"
    exit 1
  fi
  echo ""
  echo "Copying geocache from Neon..."
  pg_dump "$NEON_URL" --table=geocache --data-only | psql "$LOCAL_DATABASE_URL"
  COUNT=$(psql "$LOCAL_DATABASE_URL" -t -c "SELECT count(*) FROM geocache" | tr -d ' ')
  echo "Geocache entries: $COUNT"
fi

echo ""
echo "Next steps:"
echo "  DATABASE_URL=\"$LOCAL_DATABASE_URL\" pnpm batch:scan:dry --input scripts/repos-popular.json"
echo "  DATABASE_URL=\"$LOCAL_DATABASE_URL\" pnpm batch:scan    --input scripts/repos-popular.json"
