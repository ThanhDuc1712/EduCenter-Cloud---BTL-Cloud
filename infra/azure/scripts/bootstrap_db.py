"""Tạo role edu_migrator / edu_runtime (D-25, P0-11) và lưu chuỗi kết nối vào Key Vault.

- Mật khẩu 2 role sinh ngẫu nhiên, ghi thẳng vào Key Vault, KHÔNG in ra màn hình.
- Kết nối luôn TLS + xác minh máy chủ (sslmode=verify-full, CA từ certifi).
- Chạy lại an toàn: role đã có thì chỉ đặt lại mật khẩu và cập nhật secret (= xoay mật khẩu).
- Quyền trên bảng nghiệp vụ (audit_logs chỉ INSERT/SELECT...) do migration của Anh/Hà (P1-23) quyết định.

Chạy (PowerShell, đã `az login`, đã mở firewall IP máy bằng set-pg-firewall.ps1 -Mode AdminAdd):
  python -m pip install "psycopg[binary]" certifi azure-identity azure-keyvault-secrets
  python infra\\azure\\scripts\\bootstrap_db.py --suffix $env:EDU_SUFFIX
"""
import argparse
import secrets

import certifi
import psycopg
from azure.identity import AzureCliCredential
from azure.keyvault.secrets import SecretClient
from psycopg import sql

DB = "educenter"


def connect(host, user, password, dbname=DB):
    return psycopg.connect(host=host, port=5432, dbname=dbname, user=user, password=password,
                           sslmode="verify-full", sslrootcert=certifi.where(), connect_timeout=15)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suffix", required=True)
    ap.add_argument("--admin-user", default="eduadmin")
    ap.add_argument("--runtime-conn-limit", type=int, default=20)
    a = ap.parse_args()

    host = f"pg-educenter-{a.suffix}.postgres.database.azure.com"
    cred = AzureCliCredential()
    kv_rt = SecretClient(f"https://kv-edu-rt-{a.suffix}.vault.azure.net", cred)
    kv_ops = SecretClient(f"https://kv-edu-ops-{a.suffix}.vault.azure.net", cred)
    admin_pw = kv_ops.get_secret("pg-admin-password").value  # đã do Bicep ghi vào kv ops

    pw = {"edu_migrator": secrets.token_hex(24), "edu_runtime": secrets.token_hex(24)}

    # Tạo DB bằng chính admin để admin là owner (cấp quyền trên schema public được)
    with connect(host, a.admin_user, admin_pw, dbname="postgres") as conn:
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB,))
        if not cur.fetchone():
            cur.execute(sql.SQL("CREATE DATABASE {} ENCODING 'UTF8'").format(sql.Identifier(DB)))
            print(f"CREATE DATABASE {DB}")

    with connect(host, a.admin_user, admin_pw) as conn:
        conn.autocommit = True
        cur = conn.cursor()
        for role, limit in (("edu_migrator", 5), ("edu_runtime", a.runtime_conn_limit)):
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
            if cur.fetchone():
                verb = "ALTER"  # admin Azure không phải superuser -> chỉ đổi mật khẩu/giới hạn
                q = "ALTER ROLE {} CONNECTION LIMIT {} PASSWORD {}"
            else:
                verb = "CREATE"
                q = ("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS "
                     "CONNECTION LIMIT {} PASSWORD {}")
            cur.execute(sql.SQL(q).format(sql.Identifier(role), sql.Literal(limit), sql.Literal(pw[role])))
            print(f"{verb} ROLE {role} (connection limit {limit})")
        # Admin cần là thành viên edu_migrator để đặt default privileges thay cho role đó
        cur.execute("GRANT edu_migrator TO CURRENT_USER")
        for stmt in (
            "REVOKE ALL ON DATABASE educenter FROM PUBLIC",
            "GRANT CONNECT, TEMPORARY ON DATABASE educenter TO edu_migrator, edu_runtime",
            "GRANT USAGE, CREATE ON SCHEMA public TO edu_migrator",
            "GRANT USAGE ON SCHEMA public TO edu_runtime",
            "ALTER DEFAULT PRIVILEGES FOR ROLE edu_migrator IN SCHEMA public "
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edu_runtime",
            "ALTER DEFAULT PRIVILEGES FOR ROLE edu_migrator IN SCHEMA public "
            "GRANT USAGE, SELECT ON SEQUENCES TO edu_runtime",
        ):
            cur.execute(stmt)
        cur.execute("SHOW max_connections")
        max_conn = int(cur.fetchone()[0])

    # Chuỗi kết nối: sslmode=require là mức Prisma hiểu; Anh/Hà xác nhận tham số theo bản Prisma đang dùng.
    def url(role, limit):
        return (f"postgresql://{role}:{pw[role]}@{host}:5432/{DB}"
                f"?sslmode=require&connection_limit={limit}")

    kv_rt.set_secret("db-runtime-url", url("edu_runtime", 5), content_type="postgres-url")
    kv_ops.set_secret("db-migrator-url", url("edu_migrator", 1), content_type="postgres-url")
    print("Da luu db-runtime-url (kv runtime) va db-migrator-url (kv ops)")

    # Tự kiểm: đăng nhập bằng runtime qua TLS, không có quyền DDL
    with connect(host, "edu_runtime", pw["edu_runtime"]) as conn:
        cur = conn.cursor()
        cur.execute("SELECT current_database(), current_user, "
                    "(SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), "
                    "(SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid())")
        db, user, ssl_on, tls_ver = cur.fetchone()
        try:
            cur.execute("CREATE TABLE should_fail(id int)")
            ddl = "CO QUYEN DDL (SAI)"
        except psycopg.errors.InsufficientPrivilege:
            ddl = "bi tu choi (DUNG)"
            conn.rollback()
    print(f"runtime check: db={db} user={user} ssl={ssl_on} tls={tls_ver} create_table={ddl}")
    print(f"max_connections={max_conn}; nguong 80% = {int(max_conn * 0.8)}")


if __name__ == "__main__":
    main()
