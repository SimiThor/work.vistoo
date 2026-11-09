/**
 * DEVELOPMENT SEED — realistic German demo data for local development only.
 *
 *   npm run db:seed
 *
 * Safety: refuses to run against non-local databases unless SEED_ALLOW_REMOTE=1
 * is set explicitly. Re-runnable: removes the previously seeded demo projects
 * (identified by their names) and recreates them.
 *
 * With a local Supabase stack it also creates two demo members
 * (lena@vistoo.test, jonas@vistoo.test) so assignments can be tried out.
 */
import { and, eq, inArray } from "drizzle-orm";
import { fromDayNumber, toDayNumber, todayIso } from "@vistoo/domain/dates";
import { adminSupabase, connect, isLocalUrl, WORKSPACE_SLUG, schema } from "./lib";

const { workspaces, workspaceMembers, profiles, projects, tasks } = schema;

const DEMO_PROJECTS = ["Website-Relaunch", "Vistoo App 2.0", "Seed-Finanzierung"];

const DEMO_USERS = [
  { email: "lena@vistoo.test", fullName: "Lena Hoffmann" },
  { email: "jonas@vistoo.test", fullName: "Jonas Becker" },
];

type T = {
  title: string;
  status: "open" | "in_progress" | "in_review" | "done";
  start?: number; // offset in days from today
  end?: number;
  who?: number; // index into members, undefined = unassigned
  description?: string;
};

const PLAN: { name: string; description: string; color: string; tasks: T[] }[] = [
  {
    name: "Website-Relaunch",
    description: "Neue Marketing-Website mit klarer Positionierung",
    color: "blue",
    tasks: [
      { title: "Moodboard und Bildsprache festlegen", status: "done", start: -14, end: -10, who: 0 },
      { title: "Wireframes für Startseite und Preise", status: "done", start: -10, end: -6, who: 0 },
      { title: "Hi-Fi-Designs der Startseite", status: "in_review", start: -5, end: 1, who: 0,
        description: "Feedback aus der Runde vom Montag einarbeiten.\nFokus: Hero-Text und Kundenlogos." },
      { title: "Komponentenbibliothek aufsetzen", status: "in_progress", start: -3, end: 4, who: 1 },
      { title: "CMS-Anbindung für Blogartikel", status: "open", start: 3, end: 9, who: 1 },
      { title: "Tracking und Cookie-Banner datenschutzkonform umsetzen", status: "open", start: 8, end: 10 },
      { title: "Texte für Produktseiten finalisieren", status: "in_progress", start: 0, end: 5, who: 2 },
      { title: "Go-live-Checkliste", status: "open", end: 14, who: 2 },
      { title: "Redirects der alten URLs prüfen", status: "open" },
    ],
  },
  {
    name: "Vistoo App 2.0",
    description: "Onboarding und Team-Funktionen",
    color: "teal",
    tasks: [
      { title: "Interviews mit fünf Bestandskunden", status: "done", start: -20, end: -12, who: 2 },
      { title: "Onboarding-Flow skizzieren", status: "in_review", start: -4, end: 0, who: 2 },
      { title: "Einladungen per E-Mail", status: "in_progress", start: -2, end: 6, who: 1 },
      { title: "Rollen und Rechte", status: "open", start: 7, end: 15, who: 1 },
      { title: "Fehlermeldungen vereinheitlichen", status: "open" },
      { title: "Performance-Budget für mobile Ansicht definieren", status: "open", start: 2, end: 2 },
    ],
  },
  {
    name: "Seed-Finanzierung",
    description: "",
    color: "amber",
    tasks: [
      { title: "Pitch-Deck überarbeiten", status: "in_progress", start: -1, end: 3, who: 0 },
      { title: "Datenraum strukturieren", status: "open", start: 4, end: 11 },
      { title: "Finanzplan mit Steuerberatung abstimmen", status: "open", end: 12, who: 2 },
    ],
  },
];

async function ensureDemoUsers(db: ReturnType<typeof connect>["db"], workspaceId: string) {
  const supabase = adminSupabase();
  for (const u of DEMO_USERS) {
    let userId: string | undefined;
    const { data, error } = await supabase.auth.admin.createUser({ email: u.email, email_confirm: true });
    if (data?.user) userId = data.user.id;
    else if (error && (error.code === "email_exists" || error.status === 422)) {
      const list = await supabase.auth.admin.listUsers({ perPage: 1000 });
      userId = list.data.users.find((x) => x.email === u.email)?.id;
    } else if (error) throw error;
    if (!userId) continue;
    await db
      .insert(profiles)
      .values({ id: userId, email: u.email, fullName: u.fullName })
      .onConflictDoUpdate({ target: profiles.id, set: { fullName: u.fullName } });
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: "member" })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { status: "active", removedAt: null },
      });
  }
}

async function main() {
  const { db, client, url } = connect();
  if (!isLocalUrl(url) && process.env.SEED_ALLOW_REMOTE !== "1") {
    console.error("✗ Seed läuft nur gegen lokale Datenbanken (SEED_ALLOW_REMOTE=1 erzwingt es).");
    process.exit(1);
  }
  try {
    let [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, WORKSPACE_SLUG));
    if (!ws) [ws] = await db.insert(workspaces).values({ name: "Vistoo", slug: WORKSPACE_SLUG }).returning();

    if (isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
      await ensureDemoUsers(db, ws.id);
      console.log("✓ Demo-Mitglieder: " + DEMO_USERS.map((u) => u.email).join(", "));
    }

    const members = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.status, "active")));
    if (members.length === 0) {
      console.error("✗ Keine aktiven Mitglieder. Zuerst `npm run bootstrap:admin -- <email>` ausführen und annehmen.");
      process.exit(1);
    }
    const creator = members[0].userId;

    await db.delete(projects).where(and(eq(projects.workspaceId, ws.id), inArray(projects.name, DEMO_PROJECTS)));

    const today = toDayNumber(todayIso());
    const day = (offset?: number) => (offset === undefined ? null : fromDayNumber(today + offset));
    let position = 0;
    let count = 0;

    for (const p of PLAN) {
      const [project] = await db
        .insert(projects)
        .values({ workspaceId: ws.id, name: p.name, description: p.description, color: p.color, createdBy: creator })
        .returning();
      for (const t of p.tasks) {
        position += 1024;
        await db.insert(tasks).values({
          workspaceId: ws.id,
          projectId: project.id,
          title: t.title,
          description: t.description ?? "",
          status: t.status,
          assigneeId: t.who === undefined ? null : (members[t.who % members.length]?.userId ?? null),
          startDate: day(t.start),
          endDate: day(t.end),
          position,
          createdBy: creator,
        });
        count++;
      }
    }
    console.log(`✓ ${PLAN.length} Demo-Projekte mit ${count} Aufgaben angelegt.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("✗ Seed fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exit(1);
});
