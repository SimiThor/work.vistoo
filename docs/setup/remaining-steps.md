# Offene externe Schritte

Alles, was ohne Zugang zu Apple-Konto, Vercel- oder Supabase-Dashboard möglich war, ist vorbereitet. Diese Schritte fehlen noch, in dieser Reihenfolge:

## 1. Vercel: Root Directory umstellen (vor dem nächsten Deployment von `main`)

Die Next.js-App liegt jetzt in `apps/web`.

- Vercel → Project → Settings → Build & Deployment → **Root Directory: `apps/web`**. „Include files outside the root directory“ muss aktiv bleiben (Standard), weil `packages/*` mitgebaut werden.
- Framework bleibt Next.js, Install Command `npm install` (Vercel erkennt die Workspaces am Root-`package-lock.json`).
- `vercel.json` (Region `cdg1`, Cron) liegt jetzt in `apps/web/vercel.json` und gilt damit weiter.
- Optional neue Variablen: `MIN_IOS_BUILD` (Standard 0), `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `VISTOO_ENVIRONMENT`.

**Ohne diesen Schritt schlägt das nächste Vercel-Deployment fehl.** Deshalb erst umstellen, dann mergen; oder zuerst einen Preview-Deploy des Branches prüfen.

## 2. Supabase (Produktion): Redirect-URLs und Mail-Templates

- Auth → URL Configuration → Redirect URLs ergänzen: `https://workvistoo.vercel.app/auth/ios/confirm`.
- Auth → Emails → Templates: Inhalte aus `supabase/templates/*.html` übernehmen. Neu ist `{{ .RedirectTo }}` statt `{{ .SiteURL }}/auth/confirm`, sodass ein Link auf der Plattform landet, die ihn angefordert hat. Die Einladung enthält zusätzlich den Code (`{{ .Token }}`) für die App.
- Solange die alten Templates aktiv sind, funktioniert die App trotzdem über den **Code** aus der E-Mail. Der Link öffnet dann das Web.
- Lokal: `supabase stop && supabase start`, damit `config.toml` und die Templates neu geladen werden.

## 3. Apple Developer

1. App-ID `de.vistoo.work` anlegen (oder eigene Bundle-ID: `VISTOO_BUNDLE_ID` in `apps/ios/Config/Shared.xcconfig` **und** `IOS_BUNDLE_ID` in Vercel).
2. Capability **Associated Domains** aktivieren.
3. Team-ID in Vercel als `APPLE_TEAM_ID` setzen. Danach liefert `https://workvistoo.vercel.app/.well-known/apple-app-site-association` die Datei aus (ohne Team-ID: 404, absichtlich).
4. Lokal `apps/ios/Config/Signing.local.xcconfig` mit `DEVELOPMENT_TEAM` anlegen.
5. Bei eigener Domain (z. B. `work.vistoo.de`): `VISTOO_ASSOCIATED_DOMAIN` und `VISTOO_SERVER_URL` (Release) anpassen, `SITE_URL` in Vercel, Supabase Site-/Redirect-URLs.

## 3b. Push-Mitteilungen (APNs)

1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → „+“ → „Apple Push Notifications service (APNs)“. Die `.p8`-Datei herunterladen (nur einmal möglich), Key ID notieren.
2. App-ID `de.vistoo.work`: Capability **Push Notifications** aktivieren.
3. Vercel → Environment Variables (Production): `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (Inhalt der `.p8`, Zeilenumbrüche als `\n`), optional `APNS_BUNDLE_ID`. Die `.p8` gehört **nie** ins Repository.
4. **Vor dem Deploy** die neuen Migrationen in Produktion anwenden: `0004_push_notifications.sql`, `0005_push_security.sql` (`DIRECT_DATABASE_URL=… npm run db:migrate`). Rein additiv; die bestehende Web-Version läuft damit weiter.
5. Ohne diese Variablen funktioniert alles andere; Mitteilungen werden dann still übersprungen.

TestFlight-Builds nutzen das APNs-Produktionssystem, Xcode-Builds die Sandbox. Die App meldet das pro Gerät mit, der Server wählt den richtigen Endpunkt.

## 3c. Anhänge, Files, Besprechung (Rollout)

- Migrationen `0006_task_links` bis `0009_todos_ideas_crm_security` gegen Produktion ausführen (`npm run db:migrate` mit Produktions-`DIRECT_DATABASE_URL`), **vor** dem Web-Deployment. Rein additiv: neue Tabellen (`task_links`, `personal_todos`, `ideas`, `attractions`, `attraction_activities`), drei neue Enums, neue nullable Spalte `workspaces.meeting_url`, Unique-Constraint auf `tasks (workspace_id, id)` (immer erfüllt, da `id` Primärschlüssel ist), RLS-Policies und ein Schutz-Trigger für automatische CRM-Einträge. Bestehende Daten werden nicht verändert.
- Migrationen `0010_milestones` und `0011_milestones_security` ebenfalls vor dem Web-Deployment ausführen. Rein additiv: neue Tabelle `milestones` (RLS: nur Lesen für aktive Mitglieder, Realtime) und neue nullable Spalte `tasks.milestone_id` mit Fremdschlüssel auf denselben Workspace. Bestehende Aufgaben bleiben ohne Meilenstein.
- Discord-Link hinterlegen: als Admin unter **Einstellungen → Besprechung** (Zahnrad neben dem eigenen Namen) einfügen (Discord: Rechtsklick auf den Sprachkanal → „Link kopieren“). Für Vistoo: `https://discord.com/channels/1568996767473733634/1568996768421642354`.
- Der Google-Drive-Ordner für „Files“ steht in `apps/web/src/lib/external-links.ts`. Alle Teammitglieder brauchen in Google Drive selbst Zugriff auf den Ordner.

## 4. Erste Builds

- Simulator-Build, Login und UI-Tests gegen den lokalen Stack laufen (Xcode 26.5). Offen: Test auf einem echten iPhone gegen Produktion, echter APNs-Versand.
- TestFlight automatisch bei jedem Merge auf `main`: einmalige Einrichtung (Zertifikat, Profil, API-Key, GitHub-Umgebung `testflight`) in [ios-testflight.md](ios-testflight.md).
- App Store: Version, App-Store-Connect-Eintrag, Datenschutzangaben (Vorlage: `apps/ios/VistooWork/PrivacyInfo.xcprivacy`), Screenshots. **Nicht ohne ausdrücklichen Auftrag veröffentlichen.**

## 5. Optional

- E2E-Tests in CI: brauchen einen Supabase-Stack im Runner (z. B. `supabase start` mit Docker); aktuell nur lokal.
