-- Azure Database for PostgreSQL — application roles (D-25). Run ONCE as the server administrator:
--   psql "host=<server>.postgres.database.azure.com dbname=educenter user=eduadmin sslmode=require" \
--        -v migrator_pw=... -v runtime_pw=... -f postgres-roles.sql
-- (scripts/windows/deploy-azure.ps1 does this inside a postgres:16 container; passwords come from Key Vault.)
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE edu_migrator LOGIN NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edu_migrator') \gexec
SELECT 'CREATE ROLE edu_runtime LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edu_runtime') \gexec

ALTER ROLE edu_migrator PASSWORD :'migrator_pw';
ALTER ROLE edu_runtime PASSWORD :'runtime_pw';

-- Azure: the admin is not a superuser; grant membership so it can transfer schema ownership.
GRANT edu_migrator TO CURRENT_USER;

REVOKE ALL ON DATABASE educenter FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE educenter TO edu_migrator;
GRANT CONNECT ON DATABASE educenter TO edu_runtime;

ALTER SCHEMA public OWNER TO edu_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO edu_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE edu_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE edu_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO edu_runtime;
