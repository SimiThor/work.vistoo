# Entwicklung

Paketmanager: **npm** (Workspaces). Node ≥ 20.9. Für iOS: macOS mit Xcode 16 oder neuer (iOS-18-SDK) und XcodeGen.

## Einmalig

```bash
npm install
npm run supabase:start             # lokaler Stack: Postgres, Auth, Realtime, Storage, Mailpit
cp apps/web/.env.example apps/web/.env.local   # Werte aus der Ausgabe von `supabase start`
npm run db:migrate                 # Schema + RLS (packages/database)
npm run bootstrap:admin -- du@example.com
```

Die `.env`-Dateien liegen in **`apps/web/`**, dort wo Next.js und `vercel env pull` sie erwarten. Migrationen (`packages/database`), Seed/Bootstrap und Tests lesen dieselben Dateien, dadurch zielen sie immer auf dieselbe Umgebung wie das Web.

## Web und Backend

```bash
npm run dev            # http://localhost:3100 (Web + /api/v1)
```

Mails (Login-Codes, Einladungen) landen lokal in Mailpit: <http://127.0.0.1:54324>.

## iOS

```bash
brew install xcodegen
npm run ios:generate-project       # erzeugt apps/ios/VistooWork.xcodeproj (nicht eingecheckt)
open apps/ios/VistooWork.xcodeproj
```

- Schema **VistooWork**, Konfiguration **Debug** → Server `http://localhost:3100`. Der Simulator erreicht den Mac direkt; das Web muss mit `npm run dev` laufen.
- Physisches iPhone: `apps/ios/Config/Server.local.xcconfig` mit der LAN-Adresse des Macs anlegen (Vorlage `.example`).
- Signing: `apps/ios/Config/Signing.local.xcconfig` mit `DEVELOPMENT_TEAM` (Vorlage `.example`). Für den Simulator ist keine Signatur nötig.
- Anmelden: E-Mail eingeben, Code aus Mailpit eintippen.
- Release-Konfiguration → `https://workvistoo.vercel.app` (Produktion).

Details: [apps/ios/README.md](../apps/ios/README.md).

## Android

```bash
npm run android:install            # adb reverse 3100/54321 + Debug-Build installieren (Emulator oder Gerät per USB)
npm run android:test               # Unit-Tests (inkl. gemeinsamer Filter-Fixtures) + Lint
```

- Debug-Build → `http://localhost:3100`; dank `adb reverse` erreicht der Emulator auch die lokale Supabase-URL aus `/meta`.
- Anmelden: E-Mail eingeben, Code aus Mailpit eintippen. Details: [apps/android/README.md](../apps/android/README.md).

## Verträge und generierter Code

```bash
npm run generate        # OpenAPI, Swift-Modelle/-Endpunkte/-Konstanten, Design-Tokens (CSS + Swift)
npm run generate:check  # wie CI: schlägt fehl, wenn generierte Dateien veraltet sind
```

Nötig nach Änderungen an `packages/domain` (DTOs, Validierung, Konstanten), `packages/contracts/src` oder `packages/design-tokens/tokens.json`. Generierte Dateien werden nie von Hand geändert.

## Migrationen

```bash
npm run db:generate                          # Migration aus Schemaänderung (packages/database/src/schema.ts)
npm run db:generate -- --custom --name=xyz   # eigenes SQL (RLS, Trigger, …)
npm run db:migrate                           # anwenden (lokal; Produktion mit DIRECT_DATABASE_URL)
```

Es gibt genau eine Migrationskette: `packages/database/migrations`. Jede neue Tabelle braucht RLS, ein `REVOKE` und nur die nötigen SELECT-Policies (Vorbild `0001_security.sql`, `0003_chat_security.sql`).

## Tests und Builds

| Befehl | Was |
| --- | --- |
| `npm run typecheck` | alle TS-Workspaces |
| `npm run lint` | Web (ESLint) |
| `npm test` | Domain (inkl. gemeinsamer Filter-Fixtures), Contracts, Design-Tokens, Backend-Integrationstests inkl. `/api/v1`-Berechtigungen gegen eine Wegwerf-Postgres (`TEST_DATABASE_ADMIN_URL`, z. B. in `apps/web/.env.test.local`; Datenbankname `vistoo_test`, für parallele Läufe per `TEST_DATABASE_NAME` änderbar) |
| `npm run build` | Produktionsbuild Web |
| `npm run test:e2e` | Playwright gegen den lokalen Stack und einen laufenden Server: Web-Abläufe **und** Web ↔ iOS-Protokoll (`cross-platform.spec.ts`) |
| `npm run ios:test-kit` | VistooKit (Swift) bauen und Unit-Tests: Modelle, Filter-Fixtures, Datum, Links; auch ohne Xcode (nur Command Line Tools) |
| Xcode ⌘U bzw. `xcodebuild test` | iOS-Build, Paket-Tests und UI-Smoke-Test im Simulator |
| `npm run check` | generate:check, Typecheck, Lint, Tests, Build |

## CI

`.github/workflows/web-and-backend.yml` läuft bei Änderungen an `apps/web`, `packages/**`, `supabase/**` oder am Lockfile. `.github/workflows/ios.yml` läuft bei Änderungen an `apps/ios` und an den Paketen, die Swift-Code erzeugen (`contracts`, `domain`, `design-tokens`). Reine Web-Änderungen starten keinen macOS-Runner. Änderungen an gemeinsamen Verträgen lösen beide aus.

Auf `main` (und manuell per „Run workflow“) baut `ios.yml` nach grünen Tests zusätzlich einen signierten Release-Build und lädt ihn zu TestFlight hoch: [docs/setup/ios-testflight.md](setup/ios-testflight.md).
