# apps/ios – Hinweise

Gilt zusätzlich zur zentralen [AGENTS.md](../../AGENTS.md).

## Aufbau

```
Packages/VistooKit/                 Swift-Paket (iOS 18, Swift 6, strikte Concurrency)
  Sources/VistooCore/
    Generated/                      ← npm run generate (API-Modelle, Endpunkte, Domain-Konstanten). NICHT editieren.
    API/                            APIClient (Bearer, Retry nach RetryPolicy, Fehler → APIError)
    Auth/                           Supabase Auth, Session im Keychain
    Realtime/                       RealtimeHub (ein Workspace-Kanal + aktive Unterhaltung)
    Push/                           PushCenter: Erlaubnis, APNs-Token, Vordergrund-Darstellung, Antippen → DeepLink
    Stores/                         AppModel → SessionModel → WorkStore, ChatStore/ConversationModel, TeamStore, TodoStore, MilestoneStore, IdeaStore, DecisionStore, CRMStore (@MainActor @Observable)
    Support/                        CalendarDate, ISO8601, Dateien, Netzwerkstatus, Konfiguration
  Sources/VistooUI/
    Generated/DesignTokens.swift    ← npm run generate. NICHT editieren.
    App/ Home/ Auth/ Tasks/ Projects/ Chat/ Team/ Settings/ Components/
    Todos/ Milestones/ Ideas/ Decisions/ CRM/ More/
                                    Home = Start-Tab „Für mich“ (inkl. „Meine To-dos“); Tasks/TaskActions = Swipe/Kontextmenü für alle Aufgabenlisten;
                                    More = Tab „Mehr“, Ziele über `AreaRoute` (Components/AreaComponents.swift)
  Tests/VistooCoreTests/            Unit-Tests (u. a. gemeinsame Fixtures aus packages/contracts/fixtures)
VistooWork/                         App-Target: @main + AppDelegate (nur APNs-Token), Info.plist, Entitlements (Push, Associated Domains), Assets, Privacy Manifest
VistooWorkUITests/                  UI-Smoke-Tests
project.yml                         XcodeGen-Spezifikation (das .xcodeproj wird erzeugt, nicht eingecheckt)
scripts/ci/                         TestFlight-Pipeline (Signing, Archiv, Upload, Testgruppen), siehe docs/setup/ios-testflight.md
Config/*.xcconfig                   Server-URL je Build-Konfiguration; *.local.xcconfig sind git-ignoriert
```

## Regeln

- **Keine Fachregeln in Swift.** Berechtigungen, Invarianten und Datenregeln setzt der Server durch. Lokal sind nur schnelle Vorprüfungen erlaubt; die Werte kommen aus generierten Konstanten bzw. `Bootstrap.limits`. UI-Sichtbarkeit (z. B. Admin-Aktionen ausblenden) ist eine Darstellungsfrage, keine Sicherheitsmaßnahme.
- **Nur über `/api/v1` und Supabase Auth/Realtime.** Kein PostgREST-Schreibzugriff, keine Service-Role-Schlüssel, keine direkte Datenbankverbindung, keine Migrationen.
- **Modelle nicht von Hand schreiben.** Fehlt ein Feld, wird es in `packages/domain`/`packages/contracts` ergänzt und mit `npm run generate` erzeugt. Swift-Namen: `Task` → `TaskItem`, `Group` → `ProjectGroup` (Kollision mit `Swift.Task`/`SwiftUI.Group`; `ProjectGroup` gibt es nur noch für das stets leere, veraltete Feld `Project.groups`).
- **Offene Enums:** Immer `.unknown` behandeln (neuere Server).
- **Mutationen:** Erstellungen mit Client-ID (`newClientId()`), damit Wiederholungen keine Dubletten erzeugen. Nie Erfolg anzeigen, bevor der Server bestätigt hat. Entwürfe bei Fehlern behalten.
- **Sicherheit:** Tokens nur im Keychain (supabase-swift `KeychainLocalStorage`), nie in UserDefaults oder Logs. Beim Abmelden bzw. Accountwechsel räumt `AppModel.tearDownSession` Session-Modelle, Realtime-Kanäle und heruntergeladene Dateien ab.
- **Lebenszyklus:** Realtime nur im Vordergrund (`scenePhase`), nach Rückkehr/Reconnect Resync über die API. Keine Hintergrundverbindung voraussetzen.
- **Plattformcode:** Das Paket baut auch für macOS, damit `swift build`/`swift test` ohne Xcode laufen. iOS-only-APIs nur über Helfer in `VistooUI/Components/Platform.swift` oder `#if os(iOS)`.
- **Design:** Farben, Radien, Abstände und Typo nur über `Tokens.*`. Plattformabweichungen als `overrides.ios` in `packages/design-tokens/tokens.json` mit Begründung.
- **Barrierefreiheit:** Dynamic Type (`Tokens.Typography`, `@ScaledMetric`), VoiceOver-Labels/-Aktionen, Touch-Ziele ≥ 44 pt, Reduce Motion beachten.

## Nur-iOS-Änderungen

Nur `apps/ios` anfassen. Braucht es Serverdaten, die es noch nicht gibt, wird der Vertrag additiv erweitert ([docs/api/README.md](../../docs/api/README.md) → „Neuen Endpunkt hinzufügen“). Das Web muss nicht folgen.

## Bauen und testen

Siehe [README.md](README.md). Kurz: `npm run ios:generate-project`, Xcode öffnen, ⌘R/⌘U. Ohne Xcode: `npm run ios:test-kit`.
