import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIdeaSchema } from "@vistoo/domain/ideas";
import { createTodoSchema } from "@vistoo/domain/todos";
import { databaseSsl, SUPABASE_ROOT_CA_2021 } from "@vistoo/database/tls";
import { createIdea } from "../src/services/ideas";
import { createTask } from "../src/services/tasks";
import { createTodo } from "../src/services/todos";
import { testDatabaseUrl } from "./support/db-url";
import { addMember, makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

/**
 * Structural security invariants of the whole schema. They hold for every
 * table and function, including ones added by future migrations, so a
 * forgotten `ENABLE ROW LEVEL SECURITY` / `REVOKE` fails here (the test setup
 * grants new objects to anon/authenticated by default, exactly like Supabase).
 */
describe("database security invariants (Supabase Data API, Realtime)", () => {
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  const tables = () =>
    sql<{ name: string; rls: boolean }[]>`
      select c.relname as name, c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by 1`;

  it("has row level security enabled on every table", async () => {
    const rows = await tables();
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((t) => !t.rls).map((t) => t.name)).toEqual([]);
  });

  it("gives anon no privilege on any table, sequence or view", async () => {
    const rows = await sql<{ name: string; privilege: string }[]>`
      select table_name as name, privilege_type as privilege
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
      union all
      select c.relname, 'USAGE/SELECT'
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'S'
         and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'SELECT'))`;
    expect(rows).toEqual([]);
  });

  it("lets authenticated users only read (all writes go through the server)", async () => {
    const rows = await sql<{ name: string; privilege: string }[]>`
      select table_name as name, privilege_type as privilege
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'`;
    expect(rows).toEqual([]);
  });

  it("protects every readable table with a SELECT policy bound to the caller", async () => {
    const readable = await sql<{ name: string }[]>`
      select distinct table_name as name from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'`;
    const policies = await sql<{ table: string; cmd: string; roles: string[]; qual: string | null; permissive: string }[]>`
      select tablename as table, cmd, roles::text[] as roles, qual, permissive from pg_policies where schemaname = 'public'`;

    // Only SELECT policies exist, all for authenticated, none unconditional.
    for (const p of policies) {
      expect(p.cmd, `${p.table}: only SELECT policies`).toBe("SELECT");
      expect(p.roles, `${p.table}: policy roles`).toEqual(["authenticated"]);
      expect(p.qual ?? "", `${p.table}: policy must depend on the caller`).toMatch(
        /auth\.uid\(\)|is_active_workspace_member\(|can_access_conversation\(/,
      );
    }
    for (const { name } of readable) {
      expect(
        policies.some((p) => p.table === name),
        `${name} is readable by authenticated but has no policy`,
      ).toBe(true);
    }
  });

  it("publishes only RLS-protected tables to Realtime", async () => {
    const rows = await sql<{ name: string; rls: boolean; policies: number }[]>`
      select c.relname as name, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_publication_tables pt
        join pg_class c on c.relname = pt.tablename
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = pt.schemaname
       where pt.pubname = 'supabase_realtime'`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.rls || r.policies === 0).map((r) => r.name)).toEqual([]);
  });

  it("does not send full old rows of DELETE events (Realtime does not filter them by RLS)", async () => {
    const rows = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relreplident = 'f'`;
    expect(rows).toEqual([]);
  });

  it("hardens SECURITY DEFINER functions (fixed search_path, no anon/PUBLIC execute)", async () => {
    const rows = await sql<{ name: string; config: string[] | null; anon: boolean; isPublic: boolean }[]>`
      select p.proname as name, p.proconfig as config,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as "isPublic"
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef`;
    expect(rows.length).toBeGreaterThan(0);
    for (const f of rows) {
      expect(f.config?.some((c) => c.startsWith("search_path=")), `${f.name}: search_path`).toBe(true);
      expect(f.anon, `${f.name}: anon must not execute`).toBe(false);
      expect(f.isPublic, `${f.name}: PUBLIC must not execute`).toBe(false);
    }
  });
});

/**
 * Negative check across ALL workspace-scoped tables: whatever exists in other
 * workspaces (seeded here plus everything earlier test files created) is
 * invisible to a member of this workspace, to removed members and strangers.
 */
describe("Data API isolation across workspaces (all tables)", () => {
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  const rls = rlsClient();
  let mine: string;
  let memberId: string;
  let removedId: string;
  let strangerId: string;
  let scoped: string[];

  beforeAll(async () => {
    // Foreign workspace with content of several kinds.
    const other = await makeWorkspace("Fremd");
    const { ctx: otherCtx } = await makeMemberCtx(other.id);
    const project = await makeProject(other.id, "Geheimprojekt");
    await createTask(otherCtx, {
      projectId: project.id,
      title: "Geheime Aufgabe",
      description: "",
      status: "open",
      milestoneId: null,
      assigneeId: null,
      startDate: null,
      endDate: null,
    });
    await createIdea(otherCtx, createIdeaSchema.parse({ title: "Geheime Idee" }));
    await createTodo(otherCtx, createTodoSchema.parse({ title: "Geheimes To-do" }));

    const ws = await makeWorkspace("Eigen");
    mine = ws.id;
    memberId = (await makeMemberCtx(ws.id)).user.id;
    const removed = await makeUser();
    await addMember(ws.id, removed, "member", "removed");
    removedId = removed.id;
    strangerId = (await makeUser()).id;

    scoped = (
      await sql<{ name: string }[]>`
        select distinct g.table_name as name
          from information_schema.role_table_grants g
          join information_schema.columns c
            on c.table_schema = g.table_schema and c.table_name = g.table_name and c.column_name = 'workspace_id'
         where g.table_schema = 'public' and g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
         order by 1`
    ).map((r) => r.name);
  });

  afterAll(async () => {
    await rls.end();
    await sql.end();
  });

  it("covers the main content tables", () => {
    for (const t of ["tasks", "messages", "ideas", "personal_todos", "attractions", "decisions", "notifications"]) {
      expect(scoped).toContain(t);
    }
  });

  it("a member sees no row of any other workspace", async () => {
    let foreignRows = 0;
    for (const table of scoped) {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)} where workspace_id <> ${mine}`;
      foreignRows += n;
      const visible = await rls.asUser(memberId, (tx) =>
        tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)} where workspace_id <> ${mine}`.then((r) => r[0].n),
      );
      expect(visible, `${table}: rows of other workspaces visible`).toBe(0);
    }
    expect(foreignRows).toBeGreaterThan(0); // the check above is not vacuous
  });

  it("removed members and strangers see nothing at all", async () => {
    for (const userId of [removedId, strangerId]) {
      for (const table of scoped) {
        const visible = await rls.asUser(userId, (tx) =>
          tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)}`.then((r) => r[0].n),
        );
        expect(visible, `${table}: visible without active membership`).toBe(0);
      }
    }
  });

  it("anon cannot read any table", async () => {
    const all = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')`;
    for (const { name } of all) {
      await expect(
        rls.asUser(null, (tx) => tx`select 1 from ${tx(name)} limit 1`),
        `${name}: anon read`,
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("database connection TLS (postgres.js defaults to plaintext)", () => {
  it("encrypts and verifies Supabase connections", () => {
    const pooler = "postgresql://postgres.ref:pw@aws-1-eu-west-3.pooler.supabase.com:6543/postgres";
    expect(databaseSsl(pooler, {})).toEqual({ ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true });
    expect(databaseSsl("postgresql://postgres:pw@db.ref.supabase.co:5432/postgres", {})).toEqual({
      ca: SUPABASE_ROOT_CA_2021,
      rejectUnauthorized: true,
    });
  });

  it("requires TLS for other remote hosts and honours a custom CA", () => {
    expect(databaseSsl("postgresql://u:p@db.example.com/app", {})).toBe("require");
    expect(databaseSsl("postgresql://u:p@db.example.com/app", { DATABASE_SSL_CA: "PEM" })).toEqual({
      ca: "PEM",
      rejectUnauthorized: true,
    });
  });

  it("leaves local connections and explicit settings alone", () => {
    expect(databaseSsl("postgresql://postgres:postgres@127.0.0.1:54322/postgres", {})).toBeUndefined();
    expect(databaseSsl("postgres://localhost:5432/postgres", {})).toBeUndefined();
    expect(databaseSsl("postgres:///postgres", { PGHOST: "/tmp" })).toBeUndefined();
    expect(databaseSsl("postgresql://u:p@db.ref.supabase.co/postgres?sslmode=disable", {})).toBeUndefined();
    expect(databaseSsl("postgresql://u:p@db.ref.supabase.co/postgres", { PGSSLMODE: "verify-full" })).toBeUndefined();
  });
});
