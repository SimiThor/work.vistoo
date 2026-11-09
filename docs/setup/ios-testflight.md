# iOS: automatischer TestFlight-Build

```
Merge/Push auf main ──► GitHub Actions „iOS“
   1. Build & test        macOS-Runner: generate:check, VistooKit-Tests, Simulator-Build + UI-Tests
   2. Archive & upload    macOS-Runner: Release signieren (Apple Distribution), Upload zu App Store Connect
   3. Processing & Tester Linux-Runner: wartet auf Apples Verarbeitung, gibt den Build internen Gruppen frei
```

Workflow: [.github/workflows/ios.yml](../../.github/workflows/ios.yml). Skripte: [apps/ios/scripts/ci/](../../apps/ios/scripts/ci/).

- **Auslöser:** Push auf `main`, wenn sich iOS-relevante Dateien ändern: `apps/ios/**` (außer `*.md`), `packages/contracts|domain|design-tokens/**` (daraus wird Swift-Code erzeugt) oder der Workflow selbst. Reine Web-/Backend-Änderungen bauen keine App. Das ist richtig so, denn die App enthält keinen Web- oder Backend-Code. Sie spricht nur über `/api/v1` mit dem Server.
- **Manuell:** GitHub → Actions → **iOS** → **Run workflow** → Branch `main`. Mit dem Häkchen „Upload to TestFlight“ wird hochgeladen. Auf anderen Branches laufen nur die Tests.
- **Pull Requests:** nur Build und Tests, nie ein Upload. Forks bekommen keine Secrets.
- **Nie:** Einreichung zur App-Store-Prüfung, externe Testgruppen, Beta App Review. Das bleibt eine manuelle Entscheidung in App Store Connect.

## Ablauf und Regeln

| Thema | Umsetzung |
| --- | --- |
| Toolchain | Runner `macos-26`, **Xcode 26.5** fest (wie lokal). XcodeGen **2.46.0** als Release-Download mit SHA-256-Prüfung. Swift-Pakete nach `Package.resolved`. |
| Tests | Schlägt Job 1 fehl, startet kein Upload (`needs`). |
| Build-Nummer | UTC-Zeitstempel `YYYYMMDDHHMM`, z. B. `202611091146`. Eindeutig und steigend, gleiches Schema wie `npm run ios:testflight`. Dadurch kollidieren CI- und Hand-Uploads nie. `MIN_IOS_BUILD` im Server benutzt dieselben Zahlen. |
| Version | `MARKETING_VERSION` in [apps/ios/project.yml](../../apps/ios/project.yml) (aktuell `1.0.0`) wird von Hand erhöht. Nötig, sobald eine Version im App Store veröffentlicht ist. |
| Signatur | Nur in CI: manuelle App-Store-Signatur mit Zertifikat und Profil aus GitHub-Secrets, in einem temporären Schlüsselbund. Lokal bleibt alles bei Xcode-Automatik (`Config/Shared.xcconfig`). Vor dem Upload prüft die Pipeline Build-Nummer, Bundle-ID, Server-URL, Zertifikat, Push=production und Associated Domains. |
| Parallelität | Auf `main` werden Läufe nie abgebrochen. Neue Läufe warten, und ein überholter wartender Lauf entfällt. Uploads laufen nie gleichzeitig (`testflight-upload`). |
| Status | Job-Häkchen am Commit, Zusammenfassung pro Lauf (Version, Build, Ergebnis), Fehler als rote Annotation mit Ursache, Deployments-Liste der Umgebung `testflight`. GitHub mailt bei fehlgeschlagenen Läufen. |
| Tester | Interne Gruppen mit **automatischer Verteilung** bekommen jeden verarbeiteten Build ohne weiteres Zutun. Zusätzlich fügt Job 3 den Build den Gruppen aus `TESTFLIGHT_GROUPS` hinzu. Externe Gruppen überspringt er absichtlich. |
| Exportkonformität | `ITSAppUsesNonExemptEncryption = false` in `Info.plist`, daher keine Rückfrage. |

## Einmalige Einrichtung

Benötigte Rolle: **Account Holder** oder **Admin** im Apple Developer Program (für Zertifikat, Profil und API-Schlüssel). Team-ID: `W5A4L2PF28`, Bundle-ID: `de.vistoo.work`.

### 1. Distribution-Zertifikat (Apple Developer)

Das vorhandene „iOS Team Store Provisioning Profile“ stammt von Xcode und nutzt Apples cloudverwaltetes Zertifikat. Dessen privater Schlüssel ist nicht exportierbar, deshalb braucht die CI ein eigenes Zertifikat.

1. Xcode → **Settings → Accounts** → Apple-ID → Team auswählen → **Manage Certificates…** → **+** → **Apple Distribution**.
   (Alternativ über die Schlüsselbundverwaltung eine Zertifikatsanfrage (CSR) erstellen und unter developer.apple.com → Certificates → **+** → *Apple Distribution* hochladen.)
2. App **Schlüsselbundverwaltung** → *Anmeldung* → *Meine Zertifikate* → „Apple Distribution: … (W5A4L2PF28)“ (das neue, mit aufklappbarem privaten Schlüssel) → Rechtsklick → **Exportieren…** → Format `.p12` → **starkes Passwort** vergeben.

Ein Team darf nur wenige Distribution-Zertifikate haben (aktuell 3). Nicht mehrfach anlegen.

### 2. Provisioning Profile (Apple Developer)

developer.apple.com → **Certificates, IDs & Profiles** → **Profiles** → **+**
1. Distribution → **App Store Connect** → Continue.
2. App ID **de.vistoo.work** → Continue.
3. Das Zertifikat aus Schritt 1 auswählen (Ablaufdatum prüfen) → Continue.
4. Name: `Vistoo Work App Store CI` → Generate → **Download** (`.mobileprovision`).

Die App ID hat Push Notifications und Associated Domains bereits aktiviert. Die Pipeline bricht mit einer klaren Meldung ab, falls eine Capability fehlt.

### 3. App Store Connect API Key

appstoreconnect.apple.com → **Benutzer und Zugriff** → **Integrationen** → **App Store Connect API** → **Team-Schlüssel** → **+**
- Name: `GitHub Actions TestFlight`, Zugriff: **App Manager** (reicht für Upload und Testgruppen; nicht Admin).
- **API-Schlüssel laden** (`AuthKey_XXXXXXXXXX.p8`, nur einmal möglich). **Key ID** (Spalte „Schlüssel-ID“) und **Issuer ID** (oben auf der Seite) notieren.

### 4. Interne Testgruppe (App Store Connect)

App **Vistoo** → **TestFlight** → **Interne Tests**:
- Bestehende Gruppe öffnen (oder mit **+** anlegen) und Tester hinzufügen. Interne Tester müssen Benutzer im App-Store-Connect-Team sein.
- Empfohlen: **Automatische Verteilung** aktivieren (beim Anlegen der Gruppe „Builds automatisch verteilen“). Dann erhält die Gruppe jeden Build. Der Gruppenname kommt zusätzlich in `TESTFLIGHT_GROUPS`.

### 5. GitHub

Repository → **Settings** → **Environments** → **New environment** → Name **`testflight`**:
- **Deployment branches and tags** → *Selected branches and tags* → **`main`** hinzufügen. Damit sind die Secrets nur für `main` nutzbar. Das ist wichtig, weil das Repository öffentlich ist.
- **Environment secrets** (Werte im Terminal erzeugen, `pbcopy` legt sie in die Zwischenablage):

| Secret | Inhalt |
| --- | --- |
| `IOS_DIST_CERT_P12_BASE64` | `base64 -i Zertifikat.p12 \| pbcopy` |
| `IOS_DIST_CERT_PASSWORD` | Passwort aus Schritt 1 |
| `IOS_APPSTORE_PROFILE_BASE64` | `base64 -i Vistoo_Work_App_Store_CI.mobileprovision \| pbcopy` |
| `ASC_KEY_ID` | Key ID aus Schritt 3 |
| `ASC_ISSUER_ID` | Issuer ID aus Schritt 3 |
| `ASC_PRIVATE_KEY` | kompletter Inhalt der `.p8` inkl. `-----BEGIN/END PRIVATE KEY-----` (`pbcopy < AuthKey_XXXX.p8`) |

- **Environment variables:**

| Variable | Wert |
| --- | --- |
| `APPLE_TEAM_ID` | `W5A4L2PF28` |
| `TESTFLIGHT_GROUPS` | optional, Name(n) der internen Gruppe(n), kommagetrennt |

Danach `.p12`, `.p8` und Profil in einen Passwortmanager legen und vom Desktop löschen. Nie ins Repository legen (`.gitignore` blockiert `*.p12`, `*.p8`, `*.mobileprovision`).

### 6. Erster Lauf

Sobald der Workflow auf `main` liegt: Actions → **iOS** → **Run workflow** (Branch `main`). Erwartung: drei grüne Jobs, danach ist der Build in TestFlight sichtbar, und interne Tester bekommen eine Mitteilung in der TestFlight-App.

## Laufender Betrieb

- **Jährlich:** Zertifikat und Profil laufen nach einem Jahr ab. Die Pipeline warnt 30 Tage vorher (gelbe Annotation). Dann die Schritte 1, 2 und 5 wiederholen (neue Secrets eintragen, altes Zertifikat widerrufen).
- **Neue Capability** (z. B. iCloud): erst an der App ID aktivieren, dann das Profil neu erzeugen und `IOS_APPSTORE_PROFILE_BASE64` ersetzen.
- **Hand-Upload** bleibt möglich: `npm run ios:testflight` (Xcode-Automatik, gleiches Build-Nummern-Schema).

## Fehlersuche

| Meldung | Ursache / Lösung |
| --- | --- |
| `… is not set. Add it to the GitHub environment 'testflight'` | Secret/Variable fehlt oder Umgebung nicht auf `main` freigegeben |
| `Could not import the .p12` | falsches `IOS_DIST_CERT_PASSWORD` oder Base64 einer falschen Datei |
| `no valid 'Apple Distribution' identity` | Development-Zertifikat exportiert, oder Zertifikat abgelaufen/widerrufen |
| `does not include the distribution certificate` | Profil mit anderem Zertifikat erzeugt → Profil neu erzeugen (Schritt 2) |
| `has no Push capability` / `lacks Associated Domains` | Capability an der App ID aktivieren, Profil neu erzeugen |
| `Xcode 26.5 is not installed on this runner` | Runner-Image hat die Version entfernt → `XCODE_VERSION`/`DEVELOPER_DIR` in `ios.yml` auf eine gelistete Version setzen |
| `App Store Connect rejected the API key` / `401` | Key ID, Issuer ID oder `.p8`-Inhalt falsch, Schlüssel widerrufen |
| `403` | API-Schlüssel hat zu wenig Rechte → Rolle *App Manager* |
| `this build number already exists` | zwei Uploads in derselben Minute, Workflow neu starten |
| `Apple rejected build … (INVALID)` | Apple schickt eine Mail mit dem Grund (z. B. fehlende Privacy-Angabe) |
| `not processed within 45 min` | Apple ist langsam. Der Build erscheint meist trotzdem, Status in App Store Connect prüfen |

## Kosten

- **GitHub Actions:** Das Repository ist öffentlich. Für öffentliche Repositories sind GitHub-gehostete Standard-Runner (auch macOS) kostenlos und ohne Minutenlimit. Pro Lauf auf `main` fallen ca. 25–35 macOS-Minuten an (Tests ca. 10–15, Archiv und Upload ca. 10–15) plus bis zu 45 Linux-Minuten Warten auf Apple.
- **Falls das Repository privat wird**, zählen macOS-Minuten gegen das Kontingent und kosten danach pro Minute ein Vielfaches von Linux (aktuelle Preise: GitHub → Settings → Billing). Sparhebel dann: UI-Tests nur in PRs, auf `main` nur `swift test` vor dem Archiv.
- **Apple:** nichts zusätzlich zur Developer-Mitgliedschaft (99 USD/Jahr). TestFlight ist kostenlos.
- Unnötige Builds vermeiden die Pfadfilter (kein App-Build bei reinen Web-/Backend-/Doku-Änderungen) und die Warteschlange (überholte Commits entfallen). Swift-Pakete und npm werden gecacht. Das Release-Archiv baut bewusst ohne Build-Cache, damit es reproduzierbar bleibt.
