# Prüfungen

Stand: 6. 11. 2026. Ehrliche Übersicht: was automatisch lief, was nur kompiliert wurde, was noch offen ist.

## Ausgeführt und grün

| Prüfung | Umfang |
| --- | --- |
| Typecheck aller TS-Workspaces, ESLint (Web) | nach Monorepo-Umbau und allen Erweiterungen |
| Backend-Integrationstests (82) | bestehende 61 Tests + 21 neue `/api/v1`-Tests: Vertrag aktuell, 401/403/404/405/422, fremde Workspaces, Zugriffsentzug, Admin-only, letzter Admin, Versionsgate (426), idempotente Creates/Nachrichten, `null` vs. weglassen, Konflikt mit `current`, Archiv-Schutz, geschlossene Kanäle, Paging, Upload-Limits und Download-Berechtigung; jede Antwort wird gegen das Vertragsschema validiert |
| Domain (18), Contracts (6), Design-Tokens (3) | inkl. 13 gemeinsamer Filter-Fixtures |
| Web-Produktionsbuild | mit Workspaces; `NEXT_PUBLIC_*` korrekt inlined |
| Web-E2E (19, Playwright, lokaler Stack) | alle bestehenden Abläufe nach der Umstellung, also Prüfpunkt 10 |
| Web ↔ iOS-Protokoll-E2E (9, `cross-platform.spec.ts`) | echter Login über `/api/v1/auth/login-code` + Supabase `verifyOtp`, Bearer-API gegen den laufenden Server, Browser als Web-Gegenseite |
| VistooKit `swift build` (Core + UI) | Swift 6, strikte Concurrency, warnungsfrei, **gegen das macOS-SDK** |
| VistooKit Unit-Tests (16 Tests, 28 Fälle) | Filter-Fixtures (identisch zu TS), offene Enums, Request-Encoding, Datumslogik/Zeitzonen, Realtime-Payloads, Deep Links, Upload-Vorprüfung |
| XcodeGen | `project.yml` erzeugt Projekt und Schema (App, Paket-Tests, UI-Tests) |

## Prüfpunkte aus dem Auftrag

| # | Prüfpunkt | Nachweis |
| --- | --- | --- |
| 1 | Anmeldung mit demselben Konto auf Web und iOS | E2E 1 (Protokollebene) |
| 2 | Task im Web erstellen, auf iOS bearbeiten | E2E 2 (Web zeigt die iOS-Änderung live) |
| 3 | Status, Filter, Timeline auf beiden Plattformen | E2E 3; Filtersemantik: gemeinsame Fixtures in TS und Swift |
| 4 | Kanalnachrichten und DMs zwischen Web und iOS | E2E 4 (inkl. Ungelesen-Zustand) |
| 5 | Datei auf einer Plattform hochladen, auf der anderen öffnen | E2E 5 (beide Richtungen, gleiche Limits) |
| 6 | Zugriffsschutz geschlossene Kanäle / fremde Workspaces | E2E 6, `api.test.ts` |
| 7 | Zugriffsentzug nach Entfernung | E2E 7, `api.test.ts` |
| 8 | Rückkehr aus dem Hintergrund / Wiederverbindung | Serverseite: E2E 8 (`afterSeq` liefert genau das Verpasste). App-Seite: implementiert (`AppModel.scenePhaseChanged`, `NetworkMonitor`, `RealtimeHub` → `resyncNeeded`), **nicht im Simulator geprüft** |
| 9 | Fehlerbehandlung ohne doppelte Mutationen | E2E 9 (parallele Wiederholungen), `api.test.ts`; App: Client-IDs in `TaskDraft`, `ProjectEditor`, `PendingMessage` |
| 10 | Bestehende Webfunktionen nach Umstellung | 19 Web-E2E + 61 bestehende Integrationstests |

## Nicht ausgeführt (Umgebung)

- **Kein iOS-Build, kein Simulatorlauf, keine UI-Tests.** Auf der Entwicklungsmaschine waren nur die Command Line Tools installiert, kein Xcode. Der Swift-Code ist gegen das macOS-SDK kompiliert und getestet. iOS-spezifische Zweige (`#if os(iOS)`: Tastaturtypen, Edit-Mode, Toolbar-Platzierungen, Clipboard) und das App-Target sind **nicht** kompiliert. Die CI (`ios.yml`) baut und testet auf einem macOS-Runner. Der erste Lauf steht noch aus.
- Universal Links und Associated Domains (brauchen Apple-Team-ID, Signatur, Gerät).
- Echte Mail-Templates mit `{{ .RedirectTo }}`: Der lokale Supabase-Stack lief noch mit der alten Konfiguration. Der Code-Login war davon unabhängig und wurde geprüft.

## Manuelle Checkliste für den ersten Simulatorlauf

1. `npm run dev`, Projekt in Xcode öffnen, iPhone-Simulator starten.
2. Anmelden mit Code aus Mailpit; Einladung annehmen (neuer Nutzer); „Kein Zugang“ (Nutzer ohne Einladung).
3. Aufgaben: Board-Spalte wechseln, Swipe „Weiter“, Kontextmenü Status/Zuweisen/Reihenfolge, „Sortieren“ mit Drag-Griffen, VoiceOver-Aktionen „Eins nach oben“.
4. Timeline: Tage/Wochen, „Heute“, horizontales Scrollen mit angehefteten Titeln, Tippen → Termine mit DatePicker.
5. Gleichzeitig im Web ändern: Änderungen erscheinen ohne Reload; App in den Hintergrund und zurück → Abgleich.
6. Flugmodus: Offline-Banner; neue Aufgabe/Nachricht scheitert sichtbar, Entwurf bleibt; wieder online → „Erneut senden“ erzeugt keine Dublette.
7. Chat: ältere Nachrichten laden (kein Springen), Foto (HEIC) und PDF anhängen, Datei antippen → Quick Look → Teilen.
8. Dynamic Type „XXL“, VoiceOver, Querformat, kleines iPhone (SE) und Pro Max.
9. Abmelden, mit anderem Konto anmelden: keine Daten des vorherigen Kontos sichtbar.
