#!/bin/sh
# Local/CI database bootstrap — runs ONCE when the data volume is empty.
# Creates the two application roles defined in D-25 (ROADMAP §2.3):
#   edu_migrator — owns the schema, used only by `prisma migrate`.
#   edu_runtime  — DML only; NOT superuser, NOT owner, NO BYPASSRLS, no DDL.
# Passwords come from the container environment (.env); nothing is hardcoded.
# Table-specific restrictions (e.g. audit_logs INSERT/SELECT only) are added
# by migrations once those tables exist (P1-07 / P1-23).
set -eu

: "${EDU_MIGRATOR_PASSWORD:?EDU_MIGRATOR_PASSWORD is required}"
: "${EDU_RUNTIME_PASSWORD:?EDU_RUNTIME_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v migrator_pw="$EDU_MIGRATOR_PASSWORD" \
  -v runtime_pw="$EDU_RUNTIME_PASSWORD" <<'EOSQL'
-- CREATEDB is needed locally for Prisma's shadow database during `migrate dev`.
CREATE ROLE edu_migrator LOGIN PASSWORD :'migrator_pw'
  NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS CREATEDB;

CREATE ROLE edu_runtime LOGIN PASSWORD :'runtime_pw'
  NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 50;

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO edu_migrator;
GRANT CONNECT ON DATABASE :"db" TO edu_runtime;

ALTER SCHEMA public OWNER TO edu_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO edu_runtime;

-- Every table/sequence the migrator creates later is usable (DML only) by runtime.
ALTER DEFAULT PRIVILEGES FOR ROLE edu_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE edu_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO edu_runtime;
EOSQL

echo "educenter: roles edu_migrator / edu_runtime created"
