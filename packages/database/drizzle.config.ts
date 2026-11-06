import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// One set of environment files per checkout, next to the app that hosts the
// backend (apps/web; also where `vercel env pull` writes). Migrations always
// target the same environment as the web app and the API.
config({ path: "../../apps/web/.env.local", quiet: true });
config({ path: "../../apps/web/.env", quiet: true });

// Migrations should run over a session connection (direct or session pooler).
// Falls back to DATABASE_URL for local development.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: url ?? "" },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
