# Vistoo Work – Android

Native Android-App (Kotlin, Jetpack Compose, Material 3 als Basis im Vistoo-Design) mit dem Funktionsumfang der iOS-App. Gleiches Backend (`/api/v1`), gleiche Supabase-Umgebung, generierte Modelle aus demselben Vertrag.

## Voraussetzungen

- JDK 17+ (getestet mit Temurin 21), Android SDK mit Platform 36 (Android Studio oder Command-Line-Tools)
- `local.properties` mit `sdk.dir=…` (Android Studio legt sie an)
- Für lokale Entwicklung: laufender lokaler Stack (`npm run supabase:start`, `npm run dev`)

## Bauen, starten, testen

```bash
npm run generate          # nach Vertrags-/Token-Änderungen (erzeugt core/generated + ui/generated)
npm run android:build     # Debug-APK
npm run android:install   # adb reverse für 3100 (Web/API) und 54321 (Supabase), dann installieren
npm run android:test      # Unit-Tests + Lint
cd apps/android && ./gradlew :app:connectedDebugAndroidTest   # Start-Test auf Emulator/Gerät
```

**Server je Build-Typ** (wie `apps/ios/Config/*.xcconfig`): Debug → `http://localhost:3100` (Emulator über `adb reverse`, damit auch die von `/meta` gemeldete Supabase-URL `127.0.0.1:54321` erreichbar ist), Release → `https://workvistoo.vercel.app`. Abweichend: `vistoo.serverUrl=http://<Mac-IP>:3100` in `local.properties` oder `-Pvistoo.serverUrl=…`. Klartext-HTTP ist nur für `localhost`, `127.0.0.1` und `10.0.2.2` erlaubt.

**Anmelden lokal:** E-Mail eingeben, Code aus Mailpit (<http://127.0.0.1:54324>) eintippen.

## Architektur

| Bereich | Umsetzung | iOS-Gegenstück |
| --- | --- | --- |
| Modelle/Endpunkte/Konstanten | generiert (`packages/contracts/scripts/kotlin.ts`, kotlinx.serialization, offene Enums, `Patchable`) | generiertes Swift |
| HTTP | `ApiClient` (OkHttp, Coroutines): Bearer, einmal Refresh bei 401, Retry nur bei `safe`/`idempotent-with-client-id`, `X-Vistoo-Client: android/<build>` | `APIClient` |
| Anmeldung | `AuthService` gegen die Supabase-Auth-REST-API: E-Mail-OTP (Typ `email`, dann `invite`), Login-Link `/auth/ios/confirm` als App Link, Refresh, lokales Abmelden | supabase-swift |
| Session-Speicher | `SecureSessionStore`: AES-GCM mit nicht exportierbarem Android-Keystore-Schlüssel, kein Backup | Keychain |
| Realtime | `RealtimeHub`: Phoenix-Protokoll über OkHttp-WebSocket, gleiche Abos (Tasks per Version gemergt, Projekte, Mitglieder, Unterhaltungen, Nachrichten der offenen Unterhaltung), Heartbeat, Reconnect + Resync | `RealtimeHub` |
| Zustand | `AppModel` (in einem `AndroidViewModel`, übersteht Rotation) → `SessionModel` → Stores; Compose-Snapshot-State als direktes Gegenstück zu `@Observable` | gleich |
| Navigation | Navigation Compose mit typisierten Routen; ein Back-Stack pro Tab (wie ein `NavigationStack` pro Tab); Sheets als Vollbild-Dialoge | `TabView` + `NavigationStack` |
| Design | generierte `Tokens` (Farben, Radien, Abstände, Schatten, Typo-Rollen in sp), iOS-artige gruppierte Listen | `DesignTokens.swift` |

`AppModel` liegt in einem `ViewModel`; die Stores nutzen Compose-State statt `StateFlow`, weil sie – wie unter iOS – von vielen Screens gemeinsam beobachtet werden und so ohne zusätzliche Abbildungsschicht 1:1 der iOS-Logik folgen.

## Funktionsumfang

Wie iOS: Anmeldung (Code + Link), Einladung annehmen / kein Zugang, „Für mich“ (Ungelesen, Meine To-dos mit Schnelleingabe, eigene Aufgaben nach Dringlichkeit), Aufgaben (Board mit Statusleiste, Zeitachse Tage/Wochen, Suche inkl. `#42`, Filter, „Nur meine“, Reihenfolge, Swipe- und Langdruck-Aktionen, Erstellen/Bearbeiten mit Versionskonflikt-Dialog, Link teilen), Projekte (anlegen, bearbeiten, Farbe, archivieren/wiederherstellen), Chat (Kanäle, Direktnachrichten, ungelesen, Verlauf mit Nachladen, Senden mit Client-ID inkl. „Erneut senden“, Bearbeiten/Löschen, Fotos und Dateien hochladen, Anhänge öffnen/teilen, Kanalverwaltung inkl. Verlassen/Übergeben/Archivieren), Mehr (To-dos, Meilensteine, Ideen inkl. „Issue erstellen“, Entscheidungen/Experimente inkl. Ersetzen, Links, Verknüpfungen, Verlauf, CRM mit Kennzahlen, Filtern, Aktivitäten, Follow-ups), Einstellungen (Name, Mitteilungs-Einstellungen, Team mit Rollen/Einladungen, Chat-Speicher, Abmelden), Offline-Hinweis, Resync bei Rückkehr in den Vordergrund und nach Verbindungswechsel.

### Bewusste Abweichungen von iOS (plattformgerecht)

| iOS | Android | Grund |
| --- | --- | --- |
| Mehrere Swipe-Buttons je Seite | eine Swipe-Aktion je Richtung, alle weiteren im Langdruck-Menü | Android-Muster (`SwipeToDismissBox`) |
| Ziehen zum Sortieren | Modus „Reihenfolge ändern“/„Sortieren“ mit Auf/Ab-Schaltflächen + Langdruck „An den Anfang/Ans Ende“ | gleicher Effekt, barrierearm |
| Quick Look | Systemansicht „Öffnen mit“ bzw. Teilen über `FileProvider` | Android-Äquivalent |
| HEIC→JPEG mit ImageIO | Neukodierung über `ImageDecoder` (Ausrichtung angewendet, alle Metadaten inkl. GPS entfernt) | gleiche Wirkung |

### Einschränkungen

- **Push-Mitteilungen:** Das Backend versendet nur über APNs. Für Android fehlen FCM (Firebase-Projekt, `google-services.json`, Server-Schlüssel), eine kompatible Erweiterung von `registerDevice` um eine Plattform und der Versand in `packages/backend/src/push`. Die App fragt die Mitteilungserlaubnis (Android 13+) bereits ab; die Server-Einstellungen gelten für alle Geräte.
- **Versionssperre:** `/meta` kennt nur `minimumIosBuild`; Android-Builds werden nicht gesperrt (additiv als `minimumAndroidBuild` ergänzbar).
- **App Links:** Login-Links öffnen die App erst, wenn das Web `/.well-known/assetlinks.json` mit dem SHA-256 des Release-Zertifikats ausliefert; bis dahin landet der Link im Browser und der Code wird verwendet.
- **Markdown-Ansicht / Checklisten abhaken:** wie iOS noch nicht umgesetzt (Quelltext wird angezeigt).

## Veröffentlichung (Google Play)

1. Upload-Keystore erzeugen (`keytool -genkeypair …`), sicher verwahren; `apps/android/keystore.properties` (git-ignoriert) mit `storeFile`, `storePassword`, `keyAlias`, `keyPassword` anlegen.
2. Play-Console-Konto, App `de.vistoo.work` anlegen, Play App Signing aktivieren.
3. SHA-256 des App-Signing-Zertifikats in `apps/web/public/.well-known/assetlinks.json` eintragen (App Links für Login- und Aufgabenlinks).
4. `versionCode` je Upload erhöhen (`-Pvistoo.versionCode=…`), `./gradlew :app:bundleRelease` → `app-release.aab` hochladen (zuerst interner Test-Track).
5. Store-Eintrag: Datenschutzerklärung-URL, Datensicherheitsformular (E-Mail, Name, Nachrichten, Dateien; Übertragung verschlüsselt; Löschung auf Anfrage), Inhaltsbewertung, Screenshots, Zielgruppe.
6. Optional: FCM-Push (siehe Einschränkungen) und CI-Upload (Gradle Play Publisher oder `fastlane supply`) analog zur TestFlight-Pipeline.
