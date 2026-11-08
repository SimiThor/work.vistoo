import postgres from "postgres";
import { testDatabaseUrl } from "./db-url";

/**
 * Runs `fn` like the Supabase Data API would for a signed-in user (role
 * `authenticated`, JWT subject) or for `anon` (userId null). Always rolled back.
 */
export function rlsClient() {
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  async function asUser<T>(userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    let out: T;
    await sql
      .begin(async (tx) => {
        if (userId) {
          await tx.unsafe(`SET LOCAL ROLE authenticated`);
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
        } else {
          await tx.unsafe(`SET LOCAL ROLE anon`);
        }
        out = await fn(tx);
        throw new Error("rollback");
      })
      .catch((e) => {
        if ((e as Error).message !== "rollback") throw e;
      });
    return out!;
  }
  return { asUser, end: () => sql.end() };
}
