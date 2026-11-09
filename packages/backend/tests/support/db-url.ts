/**
 * Integration tests need a disposable PostgreSQL database (never production!).
 * TEST_DATABASE_ADMIN_URL must point to a server where the user may create
 * databases; the suite (re)creates `vistoo_test` on every run.
 */
export function adminDatabaseUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://localhost:5432/postgres";
}

/**
 * Name of the disposable database. Override with TEST_DATABASE_NAME to run
 * several suites in parallel (e.g. from different checkouts or sessions).
 */
export function testDatabaseName(): string {
  const name = process.env.TEST_DATABASE_NAME ?? "vistoo_test";
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`invalid TEST_DATABASE_NAME: ${name}`);
  return name;
}

export function testDatabaseUrl(): string {
  const url = new URL(adminDatabaseUrl());
  url.pathname = `/${testDatabaseName()}`;
  return url.toString();
}
