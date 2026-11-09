import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from "./db-url";

/**
 * Creates a fresh test database, installs minimal stand-ins for the Supabase
 * pieces our migrations depend on (roles, auth.uid(), realtime publication)
 * and applies the real drizzle migration chain.
 */
export default async function setup() {
  const admin = postgres(adminDatabaseUrl(), { max: 1, onnotice: () => {} });
  const name = testDatabaseName();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;`);
  await admin.end();

  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    CREATE SCHEMA auth;
    -- Same semantics as Supabase: subject of the JWT in request.jwt.claims.
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    -- Like Supabase: every NEW table, function and sequence in public is granted
    -- to the Data API roles. A migration that forgets to revoke is caught by
    -- tests/security.test.ts instead of silently passing here.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    CREATE PUBLICATION supabase_realtime;
  `);
  await migrate(drizzle(sql), { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  await sql.end();
}
