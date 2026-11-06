# Vistoo Work – Repository-Anleitung

Monorepo mit **zwei Oberflächen** (Web, iOS) auf **einem Backend** und **einem Datenbestand** (Supabase pro Umgebung). Lies vor Änderungen [docs/architecture/overview.md](docs/architecture/overview.md). Plattformspezifische Regeln stehen in [apps/web/AGENTS.md](apps/web/AGENTS.md) und [apps/ios/AGENTS.md](apps/ios/AGENTS.md).

```
apps/web                 Next.js (App Router) – Web-UI + Adapter: Server Actions, /api/v1, Cron. Läuft auf Vercel.
apps/ios                 SwiftUI-App: VistooKit (VistooCore + VistooUI) + App-Target (XcodeGen)
packages/database        Drizzle-Schema + EINZIGE Migrationskette (inkl. RLS), Seed/Bootstrap
packages/domain          plattformneutrale Regeln: DTO-Schemas, Validierung, Limits, Kalendertage, Filtersemantik
packages/backend         Fachlogik + Berechtigungen (services/*), Auth-Kontext, HTTP-API-Dispatcher (http/)
packages/contracts       API-Vertrag v1 → generated/openapi.json + Swift-Code; gemeinsame Test-Fixtures
packages/design-tokens   Tokens + Plattform-Overrides → CSS + Swift
docs/                    Architektur, API, Funktionsmatrix, Prüfungen, offene Schritte
```

## Grundregeln

1. **Fachregeln nur im Backend.** Berechtigungen, Invarianten und Datenregeln gehören in `packages/backend` (plus DB-Constraints/RLS in `packages/database`). Web und iOS sind Adapter und Oberflächen. Keine Regel nur in TypeScript-UI oder nur in Swift.
2. **Eine Quelle, generierte Ableitungen.** DTOs/Validierung: `packages/domain`. API: `packages/contracts/src/endpoints.ts`. Tokens: `tokens.json`. Danach `npm run generate`. Generierte Dateien (`generated/openapi.json`, `**/Generated/*.swift`, `tokens.generated.css`) nie von Hand ändern.
3. **Identität nur aus verifizierten Tokens.** Jede geschützte Operation prüft die aktive Mitgliedschaft frisch. IDs aus Requests sind kein Berechtigungsnachweis.
4. **API v1 nur additiv** ([docs/architecture/releases.md](docs/architecture/releases.md)). Installierte Apps leben länger als ein Web-Deployment.
5. **Eine Migrationskette** (`packages/database/migrations`). Die iOS-App führt nie Migrationen aus und spricht nie direkt mit Postgres.
6. **Keine Geheimnisse ins Repo** (Service-Role-Keys, Zertifikate, Provisioning-Profile, `.env*` außer `.example`).

## Aufträge nach Reichweite

**„Für beide Plattformen“**
1. Gemeinsame Regeln/Verträge anpassen: `packages/database` (Migration), `packages/domain`, `packages/backend` (+ Tests), `packages/contracts` → `npm run generate`.
2. Web-UI (`apps/web`) und iOS-UI (`apps/ios/.../VistooUI`) aktualisieren.
3. [docs/features/matrix.md](docs/features/matrix.md) und plattformübergreifende Tests aktualisieren: Backend-API-Tests, `apps/web/tests/e2e/cross-platform.spec.ts`, ggf. Fixtures in `packages/contracts/fixtures`.

**„Nur Web“**
- Nur `apps/web` ändern. iOS bleibt unangetastet.
- Braucht es Backend-Änderungen, dann nur kompatibel: neue optionale Felder oder neue Endpunkte, keine Änderung bestehender Bedeutung.

**„Nur iOS“**
- Nur `apps/ios` ändern. Die Web-UI bleibt unangetastet.
- Fehlt ein Endpunkt, wird er rückwärtskompatibel im Vertrag ergänzt (Handler ruft einen bestehenden oder neuen Service auf). Das Web muss ihn nicht nutzen.

**Konflikte benennen:** Eine gemeinsame fachliche Regel (Berechtigung, Datenregel, Limit) kann nicht nur für eine Plattform geändert werden, weil die andere Plattform denselben Service nutzt und die Regel sonst umgehbar wäre. Solche Wünsche werden ausdrücklich als Konflikt gemeldet und als Entscheidung für beide Plattformen behandelt. Eine Funktion auf einer Plattform **nicht anzuzeigen** ist dagegen eine reine UI-Entscheidung und erlaubt.

## Befehle (Root)

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Web + API lokal (Port 3100) |
| `npm run generate` / `generate:check` | Verträge, Swift-Code, Tokens erzeugen / auf Aktualität prüfen |
| `npm run typecheck`, `lint`, `test`, `build`, `check` | Prüfungen (siehe [docs/development.md](docs/development.md)) |
| `npm run test:e2e` | Playwright (lokaler Supabase-Stack + laufender Server) |
| `npm run db:generate`, `db:migrate` | Migrationen |
| `npm run ios:generate-project`, `ios:test-kit` | Xcode-Projekt erzeugen, VistooKit-Tests |

Die Umgebungsdateien liegen in `apps/web/.env*`. Migrationen, Skripte und Tests lesen sie von dort.

## Wo was dokumentiert ist

[Architektur](docs/architecture/overview.md) · [Releases & Kompatibilität](docs/architecture/releases.md) · [API](docs/api/README.md) · [Funktionsmatrix](docs/features/matrix.md) · [Prüfungen](docs/features/verification.md) · [Design-Tokens](docs/design-tokens.md) · [Entwicklung](docs/development.md) · [Offene externe Schritte](docs/setup/remaining-steps.md)
