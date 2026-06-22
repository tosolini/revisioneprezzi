#!/bin/sh
set -e

# Retry migrations in case PostgreSQL isn't ready yet
max_retries=30
n=0
until [ $n -ge $max_retries ]; do
  alembic upgrade head && break
  n=$((n + 1))
  echo "Migration attempt $n/$max_retries failed, retrying in 2s..."
  sleep 2
done

if [ $n -ge $max_retries ]; then
  echo "ERROR: Migrations failed after $max_retries attempts"
  exit 1
fi

echo "Migrations complete."
exec "$@"
