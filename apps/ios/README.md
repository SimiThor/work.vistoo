# Vistoo Work für iOS

Native SwiftUI-App mit demselben Funktionsumfang wie die Webapp. Sie nutzt dasselbe Backend (`/api/v1`) und dasselbe Supabase-Projekt wie das Web derselben Umgebung.

## Voraussetzungen

- macOS mit **Xcode 16 oder neuer** (iOS-18-SDK, Swift 6)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
- Für den Debug-Build: laufendes Web lokal (`npm run supabase:start`, `npm run dev`, siehe [docs/development.md](../../docs/development.md))

## Mindestversion: iOS 18

- Observation (`@Observable`), die neue `TabView`/`Tab`-API, `ScrollPosition` und `onScrollGeometryChange` (stabiles Chat-Scrolling, Timeline mit angehefteten Titeln), `sensoryFeedback`.
- iOS 18 läuft auf allen iPhones ab XS/XR (2018) und ist zwei Hauptversionen alt. Für ein internes Team-Tool ist das eine kleine Einschränkung.
- supabase-swift 2.55 (offizieller Client) unterstützt ab iOS 16.

## Projekt öffnen

```bash
npm run ios:generate-project      # = cd apps/ios && xcodegen generate
open apps/ios/VistooWork.xcodeproj
```

Das `.xcodeproj` wird aus `project.yml` erzeugt und nicht eingecheckt. Neue Swift-Dateien im Paket `Packages/VistooKit` sind sofort Teil des Builds.

## Umgebungen

| Build-Konfiguration | Server (`VISTOO_SERVER_URL`) | Supabase |
| --- | --- | --- |
| Debug | `http://localhost:3100` (Simulator) | vom Server via `/api/v1/meta` (lokaler Stack) |
| Release | `https://workvistoo.vercel.app` | vom Server via `/api/v1/meta` (Produktion) |

Die App kennt nur die Server-URL. Supabase-URL und Publishable Key liefert genau dieser Server. Damit nutzen Web und App zwangsläufig dieselbe Umgebung. Die Antwort wird für Offline-Starts ohne Geheimnisse gecacht.

Lokale Overrides (git-ignoriert, Vorlagen `*.example` in `Config/`):
- `Config/Server.local.xcconfig`: anderer Server für Debug, z. B. die LAN-IP des Macs für ein echtes iPhone.
- `Config/Signing.local.xcconfig`: `DEVELOPMENT_TEAM` (für Gerät/TestFlight; der Simulator braucht keine Signatur).

## Anmeldung

E-Mail eingeben, dann den Code aus der Mail eingeben (6–10 Ziffern, je nach Supabase-Einstellung) (iOS bietet ihn per AutoFill an). Alternativ den Link aus der Mail auf dem iPhone öffnen. Das funktioniert per Universal Link (`/auth/ios/confirm`), sobald die Associated Domains eingerichtet sind ([docs/setup/remaining-steps.md](../../docs/setup/remaining-steps.md)). Abgelaufene oder benutzte Links führen zu einem Hinweis. Die Session liegt im Keychain.

## Tests

| Was | Wie |
| --- | --- |
| VistooKit-Unit-Tests | Xcode ⌘U (Schema VistooWork) oder `cd Packages/VistooKit && swift test`; ohne Xcode `npm run ios:test-kit` |
| iOS-Build + UI-Smoke-Test | Xcode ⌘U bzw. `xcodebuild test -project VistooWork.xcodeproj -scheme VistooWork -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO` |
| Zusammenspiel mit dem Web | `npm run test:e2e` (`cross-platform.spec.ts` spricht das App-Protokoll) |
| Manuell | Checkliste in [docs/features/verification.md](../../docs/features/verification.md) |

## App-Icon

`VistooWork/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` wird aus der Logo-Geometrie des Webs erzeugt: `swift scripts/render-app-icon.swift <ziel.png>`.
