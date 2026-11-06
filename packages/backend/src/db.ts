import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@vistoo/database/schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Fail loudly: never fall back to a fake database.
    throw new Error(
      "DATABASE_URL is not set. Configure the Supabase Postgres connection (see README).",
    );
  }
  const client = postgres(url, {
    // Required for Supabase's transaction pooler (port 6543).
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    onnotice: () => {},
  });
  return drizzle(client, { schema, casing: undefined });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

// Reuse one pool per server instance (and across dev hot reloads).
const globalForDb = globalThis as unknown as { __vistooDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__vistooDb) globalForDb.__vistooDb = createDb();
  return globalForDb.__vistooDb;
}
