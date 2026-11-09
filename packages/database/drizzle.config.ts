import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { databaseSsl, parseDatabaseUrl } from "./src/tls";

// One set of environment files per checkout, next to the app that hosts the
// backend (apps/web; also where `vercel env pull` writes). Migrations always
// target the same environment as the web app and the API.
config({ path: "../../apps/web/.env.local", quiet: true });
config({ path: "../../apps/web/.env", quiet: true });

// Migrations should run over a session connection (direct or session pooler).
// Falls back to DATABASE_URL for local development.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

/**
 * Same TLS rules as the app (src/tls.ts). drizzle-kit only accepts a TLS
 * object with discrete credentials, so a remote URL is split up here.
 */
function credentials() {
  const ssl = databaseSsl(url);
  if (!ssl) return { url };
  const u = parseDatabaseUrl(url);
  if (!u) return { url };
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || "postgres",
    ssl,
  };
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: credentials(),
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
