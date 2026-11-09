# Architektur

```
                   ┌──────────────── apps/web (Next.js auf Vercel) ─────────────────┐
 Browser ──Server Actions──▶ app/actions ─┐                                          │
                                          ├─▶ packages/backend (Services) ──Drizzle──▶ Postgres (Supabase)
 iPhone ───HTTPS /api/v1 (Bearer)──▶ app/api/v1/[...path] ─┘   │                       ▲
                   └───────────────────────────────────────────┼───────────────────────┘ │ RLS: nur SELECT
   Browser + iPhone ──── Supabase Auth (Login) / Realtime (Signale) / Storage (signierte URLs) ──┘
```

**Ein Backend, ein Datenbestand, zwei Oberflächen.** Web und iOS verwenden pro Umgebung dasselbe Supabase-Projekt. Die iOS-App bekommt Supabase-URL und Publishable Key vom Server, mit dem sie spricht (`GET /api/v1/meta`). Deshalb kann sie nicht versehentlich eine andere Umgebung nutzen.

## Verantwortlichkeiten

| Ort | Verantwortung | Darf nicht |
| --- | --- | --- |
| `packages/database` | Drizzle-Schema, **einzige** Migrationskette (inkl. RLS, Trigger, Realtime-Publication, Storage-Bucket), Seed/Bootstrap-Skripte | – |
| `packages/domain` | Plattformneutrale Regeln: DTO-Schemas (zod), Eingabevalidierung, Konstanten und Limits, Kalendertage, Filtersemantik | Server- oder UI-Code importieren |
| `packages/backend` | Fachlogik und Berechtigungen (`services/*`), Auth-Kontext, Fehlerabbildung, HTTP-API-Dispatcher (`http/`) | Next.js- oder React-APIs nutzen |
| `packages/contracts` | Vertrag der HTTP-API v1 (`endpoints.ts`) → `generated/openapi.json` + Swift-Code; gemeinsame Konformitäts-Fixtures | Logik enthalten |
| `packages/design-tokens` | Farben, Radien, Abstände, Schatten, Typo-Rollen mit expliziten Plattform-Overrides → CSS + Swift | – |
| `apps/web` | Web-UI, Server Actions und Route Handler als **dünne Adapter** (Cookie-Session → Services), Vercel-Konfiguration | Fachregeln implementieren, die iOS nicht hat |
| `apps/ios` | Native UI (`VistooUI`), Client-Zustand, Auth/Keychain, Realtime, Lebenszyklus (`VistooCore`), App-Target | Datenbank direkt ansprechen, Migrationen, Service-Role-Schlüssel, eigene Berechtigungsregeln |

## Datenflüsse

- **Lesen und Schreiben:** immer über die Services. Web nutzt Server Actions, iOS `/api/v1`. Beide Adapter bauen den `AuthContext` gleich: Sie verifizieren das JWT (Cookie bzw. Bearer) und schlagen bei **jeder** Anfrage die aktive Mitgliedschaft frisch nach. IDs aus Requests sind kein Berechtigungsnachweis; fremde IDs verhalten sich wie nicht vorhandene.
- **Realtime:** Clients abonnieren `postgres_changes` mit dem Benutzer-JWT. Was ankommt, entscheiden die RLS-SELECT-Policies (entfernte Mitglieder bekommen nichts). Realtime ist ein Änderungssignal: Nach Reconnect, Vordergrund oder `online` lädt der Client über die API nach.
- **Dateien:** `reserveUpload` (Typ, Größe, Budget unter Workspace-Sperre) → Upload direkt in Supabase Storage per signierter URL → `finalizeUpload` (Größe + Dateisignatur) → `sendMessage`. Downloads über 60-s-Links nach erneuter Prüfung.
- **Idempotenz:** Erstellungen akzeptieren eine Client-ID (`tasks`, `projects`, Kanäle). Nachrichten werden mit Client-ID per `PUT` gesendet. Updates nutzen Versionsprüfung, Löschungen werten 404 bei einer Wiederholung als „erledigt“.

## Wo Regeln leben

| Regel | Ort | Web | iOS |
| --- | --- | --- | --- |
| Berechtigungen, Invarianten | `packages/backend` + DB-Constraints/RLS | erzwungen | erzwungen |
| Eingabevalidierung | `packages/domain/src/validation.ts` | Formular + Server | Server; Längenlimits als generierte Konstanten für Sofort-Feedback |
| Limits (Dateien, Nachrichtenlänge) | `packages/domain/src/chat-config.ts` | Konstante | `Bootstrap.limits` vom Server, Fallback generiert |
| Filtersemantik | `packages/domain/src/filters.ts` | TS-Funktion | Swift-Port, durch gemeinsame Fixtures abgesichert |
| Darstellung | jeweilige App | frei | frei |

Swift kann TypeScript nicht ausführen. Reine Client-Präsentationslogik (Filter, Sortierreihenfolge, Datumsformatierung) existiert deshalb zweimal. Damit sie nicht auseinanderläuft, prüfen `packages/contracts/fixtures/*.json` beide Implementierungen. Fachregeln mit Wirkung auf Daten oder Rechte gibt es nur im Backend.

## Beispielabläufe für Änderungen

**„Für beide Plattformen“ – Beispiel: Aufgaben bekommen eine Priorität**
1. `packages/database`: Spalte + Migration (`npm run db:generate`), mit Default. Alte Clients senden das Feld nicht.
2. `packages/domain`: `TaskSchema` um `priority` erweitern, Validierung (`createTaskSchema`, `taskPatchSchema`) um ein optionales Feld.
3. `packages/backend`: Services setzen und prüfen das Feld; Tests in `packages/backend/tests`.
4. `npm run generate`: OpenAPI und Swift-Modelle aktualisieren sich (`TaskItem.priority`, `Patch.priority`).
5. Web-UI (Panel, Karte) und iOS-UI (`TaskFieldsForm`, `TaskRowView`) ergänzen.
6. Matrix (`docs/features/matrix.md`) und ggf. Fixtures/E2E erweitern. Release-Reihenfolge siehe [releases.md](releases.md).

**„Nur Web“ – Beispiel: Tastenkürzel für den Statuswechsel**
1. Änderung nur in `apps/web/src/components/work/*`.
2. Bestehende Server Action nutzen; Vertrag und iOS bleiben unberührt. Die CI startet den iOS-Workflow nicht (Pfadfilter).
3. Braucht das Web neue Daten, wird der Service **additiv** erweitert (neues optionales Feld). Dann gilt der Ablauf „für beide Plattformen“ für das Backend, die iOS-UI bleibt unverändert.

**„Nur iOS“ – Beispiel: Swipe zum Zuweisen an mich**
1. Änderung nur in `apps/ios/Packages/VistooKit/Sources/VistooUI/Tasks/BoardView.swift`.
2. Nutzt den vorhandenen Endpunkt `setTaskAssignee`; Web und Vertrag bleiben unberührt.
3. Fehlt ein Endpunkt, wird er im Vertrag **ergänzt** (`endpoints.ts` + Handler, der einen bestehenden Service aufruft). Das ist eine kompatible Backend-Erweiterung; die Web-UI bleibt, wie sie ist.

**Konfliktfall:** Eine fachliche Regel, etwa „Mitglieder dürfen Projekte archivieren“, kann nicht nur für eine Plattform gelten. Beide Clients rufen denselben Service auf, und eine plattformabhängige Berechtigung wäre über den jeweils anderen Client umgehbar. Solche Wünsche werden ausdrücklich als Konflikt benannt und für beide Plattformen entschieden. Erlaubt ist dagegen, eine Funktion auf einer Plattform **nicht anzubieten** (UI), solange die Regel dieselbe bleibt.
