#!/bin/sh
# Create a working .env for local development.
#
# Copies .env.example, then replaces the two placeholder secrets with real
# random ones. Everything else in .env.example is already set up for the local
# docker-compose stack (Postgres, Redis, MailHog, the embedding service), so
# this is the only step between `git clone` and `docker compose up`.
#
#   ./scripts/bootstrap-env.sh          # refuses to overwrite an existing .env
#   ./scripts/bootstrap-env.sh --force  # regenerate anyway (backs the old one up)

set -e

cd "$(dirname "$0")/.."

FORCE=0
[ "$1" = "--force" ] && FORCE=1

if [ ! -f .env.example ]; then
    echo "error: .env.example not found — run this from inside the repo." >&2
    exit 1
fi

if [ -f .env ] && [ "$FORCE" -eq 0 ]; then
    echo ".env already exists — leaving it alone."
    echo "Re-run with --force to regenerate it (the old file is backed up)."
    exit 0
fi

if [ -f .env ]; then
    BACKUP=".env.backup.$(date +%Y%m%d%H%M%S)"
    cp .env "$BACKUP"
    echo "Backed up existing .env to $BACKUP"
fi

# 32 random bytes as hex. openssl is near-universal; Python is the fallback for
# the machines that don't have it (and is already required to run the tests).
gen_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import secrets; print(secrets.token_hex(32))"
    else
        echo "error: need either openssl or python3 to generate secrets." >&2
        exit 1
    fi
}

SECRET_KEY=$(gen_secret)
ENCRYPTION_KEY=$(gen_secret)

# Written with awk rather than `sed -i`: the in-place flag differs between GNU
# and BSD/macOS sed, and the replacement values are hex so there is nothing to
# escape.
awk -v sk="$SECRET_KEY" -v ek="$ENCRYPTION_KEY" '
    /^SECRET_KEY=/     { print "SECRET_KEY=" sk; next }
    /^ENCRYPTION_KEY=/ { print "ENCRYPTION_KEY=" ek; next }
    { print }
' .env.example > .env

echo "Wrote .env with freshly generated SECRET_KEY and ENCRYPTION_KEY."

# Port collisions are the most common first-run failure, and compose reports
# them as an opaque bind error per service. Name them up front instead.
BUSY=""
for PORT in 8000 5432 6379 8001 1025 8025; do
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && BUSY="$BUSY $PORT"
    fi
done

if [ -n "$BUSY" ]; then
    echo
    echo "warning: these ports are already in use:$BUSY"
    echo "  8000 api | 5432 postgres | 6379 redis | 8001 embed | 1025+8025 mailhog"
    echo "  Stop whatever holds them, or remap the 'ports:' entries in docker-compose.yml."
fi

echo
echo "Next:  docker compose up -d     (first build takes a while — see README)"
