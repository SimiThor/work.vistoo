/**
 * Integration tests need a disposable PostgreSQL database (never production!).
 * TEST_DATABASE_ADMIN_URL must point to a server where the user may create
 * databases; the suite (re)creates `vistoo_test` on every run.
 */
export function adminDatabaseUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://localhost:5432/postgres";
}

export function testDatabaseUrl(): string {
  const url = new URL(adminDatabaseUrl());
  url.pathname = "/vistoo_test";
  return url.toString();
}
