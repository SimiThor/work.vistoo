# apps/android – Hinweise

Gilt zusätzlich zur zentralen [AGENTS.md](../../AGENTS.md). Die Android-App ist eine native Umsetzung der iOS-App (gleiche Funktionen, gleiche Abläufe, gleiche Texte) auf demselben Backend.

## Aufbau

```
app/src/main/java/de/vistoo/work/
  core/generated/     ← npm run generate (API-Modelle, Endpunkte, Domain-Konstanten aus dem Vertrag). NICHT editieren.
  core/api/           ApiClient (OkHttp, Bearer, Retry nach RetryPolicy, Fehler → ApiError), JSON, ISO 8601, Patchable
  core/auth/          AuthService (Supabase Auth REST: E-Mail-Code, Login-Link, Refresh), SecureSessionStore (Keystore, AES-GCM)
  core/realtime/      RealtimeHub (Supabase Realtime/Phoenix über WebSocket; Workspace-Kanal + aktive Unterhaltung)
  core/stores/        AppModel → SessionModel → WorkStore, ChatStore/ConversationModel, TeamStore, TodoStore, MilestoneStore,
                      IdeaStore, DecisionStore, CRMStore (Compose-Snapshot-State, Hauptthread)
  core/support/       CalendarDate, Konfiguration, Netzwerkstatus, Dateien
  ui/generated/       ← npm run generate (Design-Tokens). NICHT editieren.
  ui/                 Compose-Screens, gleiche Gliederung wie VistooUI: app/ home/ auth/ tasks/ projects/ chat/ team/ settings/
                      components/ todos/ milestones/ ideas/ decisions/ crm/ more/
app/src/test/         Unit-Tests (u. a. gemeinsame Fixtures aus packages/contracts/fixtures)
app/src/androidTest/  Instrumentierter Start-Test (Emulator)
```

## Regeln

Dieselben wie für iOS ([apps/ios/AGENTS.md](../ios/AGENTS.md)), übertragen:

- **Keine Fachregeln in Kotlin.** Der Server entscheidet; lokal nur schnelle Vorprüfungen aus generierten Konstanten bzw. `Bootstrap.limits`.
- **Nur `/api/v1` und Supabase Auth/Realtime.** Kein PostgREST-Schreibzugriff, keine Service-Role-Schlüssel.
- **Modelle nicht von Hand schreiben.** Fehlt ein Feld: `packages/domain`/`packages/contracts` ergänzen, `npm run generate`. Namen wie in Swift (`Task` → `TaskItem`).
- **Offene Enums:** immer `Unknown` behandeln.
- **Mutationen:** Erstellungen mit Client-ID (`newClientId()`); Erfolg erst nach Serverantwort; Entwürfe bei Fehlern behalten.
- **Sicherheit:** Session nur verschlüsselt im `SecureSessionStore`, nie in Logs; kein Backup (`data_extraction_rules.xml`). Abmelden räumt Session-Modelle, Realtime und Downloads ab.
- **Lebenszyklus:** Realtime nur im Vordergrund (`onStart`/`onStop`), danach Resync über die API.
- **Design:** Farben, Radien, Abstände, Typo nur über `Tokens.*`; Android-Abweichungen als `overrides.android` in `packages/design-tokens/tokens.json` mit Begründung.
- **UI-Parität:** Neue iOS-Funktionen werden hier gleich umgesetzt (gleiche Texte); bewusste Abweichungen in [README.md](README.md) dokumentieren.

## Bauen und testen

Siehe [README.md](README.md). Kurz: `npm run android:build`, `npm run android:test`, `npm run android:install`.
