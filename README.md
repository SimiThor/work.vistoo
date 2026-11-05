# Vistoo – internes Projektmanagement

Ein bewusst schlankes Tool für ein kleines Team: Kanban-Board und Timeline über denselben Aufgaben, Projekte mit Gruppen, einfache Filter und eine Teamverwaltung mit Einladungen.

**Stack:** Next.js 16 (App Router, Cache Components) · TypeScript strict · Supabase (Postgres, Auth, Realtime) · Drizzle ORM · Tailwind CSS 4 · shadcn/ui (Radix) · dnd-kit · Zod · Vercel.

---

## Inhalt

1. [Architektur in Kürze](#architektur-in-kürze)
2. [Lokale Entwicklung](#lokale-entwicklung)
3. [Supabase einrichten (Produktion)](#supabase-einrichten-produktion)
4. [Erster Admin (Bootstrap)](#erster-admin-bootstrap)
5. [Auth-Redirects und E-Mail](#auth-redirects-und-e-mail)
6. [Realtime](#realtime)
7. [Deployment auf Vercel](#deployment-auf-vercel)
8. [Befehle](#befehle)
9. [Tests](#tests)
10. [Produktentscheidungen und Grenzen](#produktentscheidungen-und-grenzen)

---

## Architektur in Kürze

```
Browser ──(Server Actions)──▶ Next.js Server ──(Drizzle, privilegierte Verbindung)──▶ Postgres
   │                                │
   │                                └─ verifiziert JWT (Supabase Auth) + prüft Mitgliedschaft bei JEDEM Zugriff
   └──(Auth, Realtime: nur SELECT via RLS)──▶ Supabase
```

- **Autorisierung im Server:** Drizzle verbindet sich mit einer privilegierten Rolle, RLS greift dort also *nicht*. Deshalb läuft jeder Lese- und Schreibzugriff über die Service-Schicht in `src/server/services/*`. Sie bekommt einen `AuthContext`, der ausschließlich serverseitig gebaut wird: Der JWT wird verifiziert (`getClaims`), danach folgt ein frischer DB-Lookup der **aktiven** Mitgliedschaft. Alle Queries sind auf `ctx.workspaceId` beschränkt. IDs aus dem Client sind nie ein Berechtigungsnachweis; fremde IDs verhalten sich wie nicht existierende.
- **Mutationen:** Server Actions (`src/app/actions/*`) → `runAction` (Auth, optional Admin-Rolle, Zod-Validierung, Fehler-Mapping) → Service.
- **RLS als zweite Linie:** RLS ist auf allen Tabellen aktiv. Über die Supabase-API bekommen angemeldete Nutzer **nur SELECT** auf Zeilen ihres Workspaces, und nur als aktive Mitglieder. Mehr braucht Realtime nicht. Es gibt keine Insert-, Update- oder Delete-Policies; `profiles` und `workspace_invitations` sind über die API gar nicht erreichbar.
- **Integrität in der DB:** zusammengesetzte Foreign Keys (Task ↔ Projekt ↔ Workspace, Task ↔ Gruppe desselben Projekts, Assignee ↔ Mitgliedschaft im Workspace), Trigger „Assignee muss aktiv sein“, Trigger „beim Entfernen Zuweisungen lösen“, Check `end_date >= start_date`, eindeutige Mitgliedschaften und offene Einladungen.
- **Konflikte:** Jede Task hat eine `version`. Das Speichern im Detailpanel ist ein bedingtes Update (`WHERE version = expected`). Bei einem Konflikt zeigt die UI einen Hinweis mit „Aktuelle Version laden“ oder „Trotzdem speichern“.
- **Client-State:** ein schlanker Store (`src/components/work/work-context.tsx`) mit Optimistic Updates und Rollback. Realtime-Ereignisse und Server-Antworten werden über die Version zusammengeführt, ohne Duplikate.
- **Rendering:** Cache Components / Partial Prerendering. Statische Shell (Navigation, Skeletons), benutzerbezogene Inhalte streamen hinter `<Suspense>`. Nutzerdaten werden nie mit `use cache` gecacht; React `cache()` dedupliziert nur innerhalb eines Requests.
- **Ein Migrationssystem:** `drizzle-kit`. Das Schema liegt in `src/server/db/schema.ts`. RLS, Funktionen, Trigger und die Realtime-Publication stehen als *custom migration* in derselben Kette (`drizzle/0001_security.sql`). Die Supabase-CLI dient nur dem lokalen Stack, ihre Migrations werden nicht verwendet.

Verzeichnisse:

| Pfad | Inhalt |
| --- | --- |
| `src/server/` | DB-Client, Schema, Auth-Kontext, Service-Schicht, Mailer (nur Server) |
| `src/app/actions/` | Server Actions |
| `src/app/(app)/` | Arbeitsseiten: Alle Aufgaben, Projekte, Team |
| `src/components/work/` | Board, Timeline, Filter, Task-Panel, Store, Realtime |
| `src/lib/` | Domänen-Konstanten, Validierung, Kalenderdatum-Logik (Client + Server) |
| `drizzle/` | versionierte Migrationen inkl. RLS |
| `scripts/` | Bootstrap des ersten Admins, Development-Seed |
| `tests/` | Integrationstests (Vitest, echte Postgres-DB), `tests/e2e` (Playwright) |

---

## Lokale Entwicklung

Voraussetzungen: Node ≥ 20.9, Docker (für den lokalen Supabase-Stack).

```bash
npm install
npm run supabase:start          # startet Postgres, Auth, Realtime, Mailpit lokal
```

`supabase start` gibt URLs und Schlüssel aus. Lege `.env.local` an:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<"Publishable key" aus der Ausgabe>
SUPABASE_SECRET_KEY=<"Secret key" aus der Ausgabe>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SITE_URL=http://localhost:3100
```

```bash
npm run db:migrate                          # Schema + RLS anwenden
npm run bootstrap:admin -- du@example.com   # ersten Admin einladen
npm run dev
```

Die App läuft lokal auf <http://localhost:3100> (Port 3100, um Konflikte mit anderen Projekten auf 3000 zu vermeiden). Die Einladungs-E-Mail landet lokal in **Mailpit**: <http://127.0.0.1:54324>. Link öffnen, Namen eingeben, „Einladung annehmen“.

Optional Demo-Daten (nur lokal, wiederholbar):

```bash
npm run db:seed     # 3 Projekte, Gruppen, Aufgaben; lokal zusätzlich lena@ / jonas@vistoo.test
```

Lokale Auth-Einstellungen (keine öffentliche Registrierung, E-Mail-Templates, Redirect-URLs) liegen in `supabase/config.toml` und `supabase/templates/`.

---

## Supabase einrichten (Produktion)

1. **Projekt anlegen** auf supabase.com (Region nahe am Vercel-Deployment, z. B. Frankfurt).
2. **Datenbank-Verbindungen** (Project Settings → Database → Connect):
   - `DATABASE_URL`: *Transaction pooler* (Port 6543), für die App auf Vercel.
   - `DIRECT_DATABASE_URL`: *Session pooler* (Port 5432) oder direkte Verbindung, für Migrationen.
3. **API-Schlüssel** (Project Settings → API Keys): Publishable Key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, Secret Key → `SUPABASE_SECRET_KEY`. Legacy-`anon`/`service_role`-Keys funktionieren ebenfalls (`NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`).
4. **Migrationen anwenden** (lokal mit den Produktions-Variablen):
   ```bash
   DIRECT_DATABASE_URL=… npm run db:migrate
   ```
5. **Auth → Sign In / Providers → Email:** Email-Provider aktiv, **„Allow new users to sign up“ deaktivieren**. Neue Konten entstehen nur über Einladungen (Admin-API).
6. **Auth → URL Configuration:** siehe [Auth-Redirects](#auth-redirects-und-e-mail).
7. **Auth → Emails → Templates:** siehe unten.
8. **SMTP:** Der eingebaute Supabase-Mailer ist stark limitiert (wenige Mails pro Stunde) und nur für Tests gedacht. Für den Betrieb unter Auth → SMTP Settings einen eigenen Anbieter eintragen (z. B. Postmark, Resend, SES).

> **Hinweis zu neuen Tabellen:** Supabase gibt neu angelegten Tabellen im Schema `public` standardmäßig Rechte für `anon`/`authenticated`. Jede künftige Tabelle braucht in ihrer Migration `ENABLE ROW LEVEL SECURITY`, ein explizites `REVOKE` und nur die nötigen Policies (Vorbild: `drizzle/0001_security.sql`).

---

## Erster Admin (Bootstrap)

```bash
npm run bootstrap:admin -- admin@vistoo.de
```

- legt den Workspace „Vistoo“ an, falls er fehlt,
- **verweigert** die Ausführung, sobald es einen aktiven Admin gibt (keine versteckte Hintertür; weitere Admins werden in der Teamansicht eingeladen),
- erzeugt eine an diese E-Mail gebundene Admin-Einladung (7 Tage gültig) und verschickt die Einladung über Supabase Auth.

Ohne Projekt-Secrets (`DATABASE_URL`, `SUPABASE_SECRET_KEY`) lässt sich das Skript nicht ausführen. Es gibt keine Standardpasswörter; die Anmeldung läuft ausschließlich über E-Mail (Magic Link oder Code).

---

## Auth-Redirects und E-Mail

**URL Configuration** (Auth → URL Configuration):

- *Site URL*: `https://<deine-domain>` (wird in den E-Mail-Templates als `{{ .SiteURL }}` verwendet)
- *Redirect URLs*: `https://<deine-domain>/auth/confirm`, für Preview-Deployments optional `https://*-<team>.vercel.app/auth/confirm`

**E-Mail-Templates** (Auth → Emails). Die Links verwenden `token_hash`, damit sie auch in einem anderen Browser funktionieren, als die Anmeldung angefordert wurde:

*Magic Link*, Betreff „Dein Anmeldelink für Vistoo“:
```html
<h2>Anmeldung bei Vistoo</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Jetzt anmelden</a></p>
<p>Oder gib diesen Code auf der Anmeldeseite ein: <strong>{{ .Token }}</strong></p>
```

*Invite user*, Betreff „Einladung zu Vistoo“:
```html
<h2>Du wurdest zu Vistoo eingeladen</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite">Einladung annehmen</a></p>
```

(Identisch zu `supabase/templates/*.html`.) Mit den Standard-Templates funktioniert die Anmeldung über einen Fallback (Tokens im URL-Fragment) ebenfalls, die obigen Templates sind aber robuster.

**Ablauf:** Login-Seite → E-Mail → Link oder 6-stelliger Code → `/auth/confirm` setzt die Session → ohne Mitgliedschaft geht es zu `/invite`. Dort wird nur eine offene, nicht abgelaufene Einladung angezeigt, die an genau diese verifizierte Adresse gebunden ist. Eine erfolgreiche Anmeldung allein gibt keinen Zugriff auf Workspace-Daten.

---

## Realtime

- Die Tabellen `tasks`, `projects`, `project_groups` und `workspace_members` werden durch die Migration der Publication `supabase_realtime` hinzugefügt. Im Dashboard ist nichts weiter nötig. Kontrolle: Database → Publications.
- Clients abonnieren `postgres_changes`, gefiltert auf `workspace_id`. **Der Zugriffsschutz kommt aus RLS:** Realtime prüft für jeden Abonnenten die SELECT-Policy. Entfernte Mitglieder erhalten sofort keine Ereignisse mehr.
- DELETE-Ereignisse enthalten nur die ID.
- Nach einem Reconnect, nach `online` und wenn der Tab nach mehr als 30 s wieder sichtbar wird, lädt der Client den aktuellen Stand vollständig nach.

---

## Deployment auf Vercel

1. Repository in Vercel importieren (Framework: Next.js, Build: `next build`).
2. Environment Variables setzen (Production und Preview):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL` (Transaction Pooler, 6543), `SITE_URL` (z. B. `https://work.vistoo.de`).
3. Migrationen werden **nicht** automatisch beim Build ausgeführt. Vor dem Deploy einer Schemaänderung manuell ausführen: `npm run db:migrate` mit `DIRECT_DATABASE_URL`.
4. In Supabase Site URL und Redirect URLs auf die Vercel-Domain setzen (siehe oben).

Fehlt die Supabase-Konfiguration, antwortet die App mit einer klaren Fehlermeldung. Es gibt bewusst keinen Fake-Fallback.

---

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run build` / `npm start` | Produktionsbuild / -server |
| `npm run typecheck` | TypeScript (strict) |
| `npm run lint` | ESLint |
| `npm test` | Integrations- und Unit-Tests (Vitest, echte Postgres-DB) |
| `npm run test:e2e` | End-to-End (Playwright, lokaler Supabase-Stack + laufender Server) |
| `npm run check` | Typecheck, Lint, Tests, Build |
| `npm run db:generate` | Migration aus Schemaänderung erzeugen (`-- --custom --name=x` für eigenes SQL) |
| `npm run db:migrate` | Migrationen anwenden |
| `npm run db:seed` | Demo-Daten (nur lokal) |
| `npm run bootstrap:admin -- <email>` | ersten Admin einladen |
| `npm run supabase:start` / `supabase:stop` | lokaler Supabase-Stack |

---

## Tests

**Integrationstests** (`tests/*.test.ts`) laufen gegen eine echte, wegwerfbare Postgres-Datenbank. Bei jedem Lauf wird `vistoo_test` neu erzeugt, mit minimalen Supabase-Stubs (`auth.uid()`, Rollen, Publication) versehen und mit den **echten** Drizzle-Migrationen aufgesetzt. Geprüft werden unter anderem:

- Zugriff ohne bzw. mit entfernter Mitgliedschaft, workspace-fremde IDs
- RLS: Mitglieder lesen, Entfernte, Fremde und `anon` sehen nichts, kein Schreiben über die API
- unberechtigte Admin-Aktionen, letzter Admin (auch bei gleichzeitiger gegenseitiger Herabstufung)
- ungültige Gruppenzuordnung (Service **und** DB-Constraint), Gruppenreset beim Projektwechsel
- ungültige Datumsbereiche, Kalendertage ohne Zeitzonenverschiebung
- Versionskonflikte (auch parallel), Board-Reihenfolge inkl. Renormalisierung
- Einladungen: E-Mail-Bindung, Ablauf, Widerruf, erneutes Senden, Re-Invite, Rollback bei Mailfehler
- Entfernen: Zugriff weg, Tasks bleiben, Zuweisung gelöst, Ersteller bleibt

```bash
# Server, auf dem `vistoo_test` angelegt werden darf (Default: postgres://localhost:5432/postgres)
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres npm test
```

Lokale Overrides können in `.env.test.local` stehen (wird nicht committet).

**End-to-End** (`tests/e2e`) braucht den lokalen Supabase-Stack mit Mailpit und einen laufenden Server:

```bash
npm run supabase:start && npm run db:migrate
npm run build && npm start &      # oder npm run dev
npm run test:e2e
```

---

## Produktentscheidungen und Grenzen

- **Sortieren bei aktiven Filtern** ist erlaubt. Eine Aufgabe wird zwischen ihre *sichtbaren* Nachbarn einsortiert, ausgeblendete Aufgaben behalten ihre Position. Die UI weist darauf hin. Statuswechsel gehen immer, auch über das Kartenmenü und das Detailpanel (tastaturbedienbar).
- **Schnellaktionen** (Status, Person, Verschieben) speichern sofort und bewusst ohne Versionsprüfung, weil sie jeweils genau ein Feld setzen. Das Detailformular speichert explizit mit Versionsprüfung.
- **Neue Aufgaben** übernehmen eindeutige Filterwerte (Projekt, Gruppe, Person), damit sie sichtbar bleiben.
- **Archivierte Projekte** sind in „Alle Aufgaben“ ausgeblendet und schreibgeschützt, bleiben aber über die Projektliste erreichbar.
- **Zurückgestellt:** Task-Abhängigkeiten (optional laut Briefing), Drag zum Verschieben von Timeline-Balken, Dark Mode. Für zurückgestellte Funktionen gibt es keine Bedienelemente.
- **Nicht Teil des MVP:** Billing, öffentliche Registrierung, Gäste, Kommentare, Anhänge, Zeiterfassung, Automationen, Benachrichtigungen, Custom Fields, Workflows, Unteraufgaben, KI, Reporting.
