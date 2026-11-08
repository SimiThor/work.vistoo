# Funktionsmatrix Web ↔ iOS

Quelle des Funktionsumfangs ist die bestehende Webapp. Jede Zeile nennt die Web-Umsetzung, die iOS-Darstellung, die **eine** gemeinsame Backend-Logik und ein prüfbares Fertigstellungskriterium. Status: ✅ umgesetzt und automatisch geprüft · 🟡 umgesetzt, aber nur kompiliert/unit-getestet (iOS-UI ohne Simulatorlauf, siehe [verification.md](verification.md)).

Pfade: Web `apps/web/src`, iOS `apps/ios/Packages/VistooKit/Sources`, Backend `packages/backend/src/services`, Vertrag `packages/contracts/src/endpoints.ts`.

## Anmeldung und Zugang

| Funktion | Web (Bestand) | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Login per E-Mail-Code / Magic Link, keine Registrierung | `app/login`, `actions/auth.ts` | `SignInView` (E-Mail → Code, Auto-Fill), Universal Link `/auth/ios/confirm` | `services/login.ts` `requestLoginCode` (inkl. „eingeladen, nicht bestätigt → Einladung erneut senden“); `POST /auth/login-code` | gleicher Account meldet sich auf beiden Plattformen an; unbekannte Adressen sind nicht unterscheidbar | ✅ E2E `cross-platform` 1 · 🟡 UI |
| Einladung annehmen | `/invite` | `OnboardingView` | `services/invitations.ts` `acceptInvitation`; `GET /me`, `POST /invitations/accept` | nur offene, gültige Einladung an die verifizierte Adresse; abgelaufen → Hinweis | ✅ Backend-Tests · 🟡 UI |
| Kein Zugang / abgelaufen | `/invite` | `OnboardingView` (Zustände none/expired) | `services/session.ts` `getMe` | `GET /me` liefert `access` ohne Workspace-Daten | ✅ `api.test.ts` |
| Abmelden | Benutzermenü | Team-Tab → „Mein Konto“ | Supabase Auth | Keychain-Session, Realtime-Kanäle, Downloads und Stores werden entfernt | 🟡 (`AppModel.signOut`) |
| Zugriffsentzug bei laufender Session | jede Anfrage prüft Mitgliedschaft | jede API-Anfrage prüft Mitgliedschaft; 403 → `/me` → Onboarding | `auth.ts` `resolveMembership` pro Request; RLS für Realtime | entferntes Mitglied bekommt sofort 403 bzw. keine Events | ✅ E2E 7, `api.test.ts` |

## Projektmanagement

| Funktion | Web (Bestand) | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Projekte ansehen (aktiv/archiviert, Fortschritt) | `/projects` | `ProjectsScreen` (Sektionen, „x/y erledigt“) | `projects.listProjects`, `projectStats`; `GET /projects` | gleiche Liste/Zahlen | ✅ API · 🟡 UI |
| Projekt erstellen / bearbeiten (Name, Beschreibung, Farbe) | `project-dialog.tsx` | `ProjectEditor` (Sheet, Farbraster) | `createProject` (idempotent per Client-ID), `updateProject` | iOS-Projekt erscheint im Web | ✅ E2E 2 |
| Archivieren / Wiederherstellen (archiviert = schreibgeschützt) | `project-actions.tsx` | Swipe, Kontextmenü, Projektmenü | `setProjectArchived`; Guard `getWritableProject` | Schreibversuche auf archivierte Projekte → `ARCHIVED` | ✅ `api.test.ts` |
| Gruppen anlegen / umbenennen / löschen (Aufgaben bleiben) | `groups-dialog.tsx` | `GroupsEditor` | `createGroup`, `renameGroup`, `deleteGroup` | Löschen löst Gruppe von Aufgaben | ✅ Backend-Tests · 🟡 UI |
| Aufgabe erstellen (übernimmt eindeutige Filterwerte) | Quick-Add, Panel | `TaskCreateView` (Sheet), Regel aus `WorkScreen.newTask` | `createTask` (idempotent per Client-ID) | Wiederholung nach Netzfehler erzeugt keine Dublette | ✅ E2E 9 |
| Aufgabe bearbeiten (Titel, Beschreibung, Status, Projekt, Gruppe, Person, Termine) | `task-panel.tsx` | `TaskDetailView` (Form, native Picker/DatePicker) | `updateTask` mit `expectedVersion`; Konflikt → `current` | Web-Aufgabe auf iOS bearbeiten, Web aktualisiert live | ✅ E2E 2 |
| Versionskonflikt | Hinweis „Aktuelle Version laden / Trotzdem speichern“ | gleicher Dialog als Alert | `CONFLICT` + `error.current` | identisches Verhalten | ✅ `api.test.ts` · 🟡 UI |
| Aufgabe löschen | Kartenmenü, Panel | Swipe, Kontextmenü, Detail | `deleteTask` (404 bei Wiederholung = erledigt) | | ✅ `api.test.ts` |
| Kanban mit Statuswechsel | Board (dnd-kit, Tastatur, Menü) | `BoardView`: Statusauswahl + Spaltenliste; Swipe „Weiter“, Kontextmenü „Status ändern“ | `setTaskStatus`, `moveTask` | Statuswechsel auf iOS erscheint im Web und umgekehrt | ✅ E2E 3 |
| Gespeicherte Reihenfolge | Drag & Drop zwischen sichtbare Nachbarn | „Sortieren“ (Drag-Griffe) + Kontextmenü „Reihenfolge“ + VoiceOver-Aktionen | `moveTask` (fraktionale Positionen, Renormalisierung) | gleiche Platzierungsregel | ✅ `tasks.test.ts`, `api.test.ts` · 🟡 UI |
| Zuweisen | Kartenmenü, Panel | Kontextmenü „Zuweisen“, Detail | `setTaskAssignee` (nur aktive Mitglieder) | | ✅ |
| Timeline/Gantt (Tag/Woche, Heute, nicht geplante Aufgaben) | `timeline.tsx` | `TimelineView`: horizontale Achse, Namen über dem Balken links angeheftet, Zoom + „Heute“ unten, Tippen → Detail mit DatePickern | Kalendertage ohne Zeitzone (`CalendarDate` ↔ `dates.ts`) | iOS-Termine erscheinen exakt im Web | ✅ E2E 3, `DateTests` · 🟡 UI |
| Suche und Filter (Projekt, Gruppe, Person, Status; OR/AND) | Filterleiste, URL | `.searchable` + `FilterSheet` | Semantik `packages/domain/src/filters.ts`; Fixtures `packages/contracts/fixtures/task-filters.json` | 13 gemeinsame Fälle grün in TS **und** Swift | ✅ |
| „Alle Aufgaben“ vs. Projektansicht | `/tasks`, `/projects/[id]` | Tab „Aufgaben“, Projekt-Detail | `listTasks` (alle aktiven / ein Projekt) | | ✅ |
| Task-Verlinkung | „Link kopieren“ (`/tasks?task=…`) | „Link teilen“ (Share Sheet), Universal Link öffnet die Aufgabe | gleiche URL-Form, `GET /tasks/{id}` | geteilter Link öffnet im Web bzw. in der App | ✅ `LinkTests` · 🟡 Universal Link (Apple-Setup offen) |
| Anhänge: externe Links an Aufgaben (Drive, Docs, Figma, GitHub …; hinzufügen, öffnen, bearbeiten, entfernen) | `work/task-links.tsx` im Panel (inline, Live-Aktualisierung über Realtime `task_links`) | **noch nicht in der UI** (Modelle `TaskLink`, Endpunkte generiert) | `task-links.ts` (nur http(s), max. 50 pro Aufgabe, archiviert = schreibgeschützt, idempotent per Client-ID); `GET/POST /tasks/{id}/links`, `PATCH/DELETE /task-links/{id}`; RLS nur SELECT für aktive Mitglieder | Link erscheint sofort und live bei anderen; unsichere URLs werden abgelehnt (Schema + DB-Check) | ✅ `task-links.test.ts`, `api.test.ts`, E2E `flow` · iOS offen |
| Abhängigkeiten | **nicht vorhanden** (zurückgestellt) | – | – | – | – |

## Team

| Funktion | Web (Bestand) | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Mitgliederliste, eigene Rolle | `/settings` (Zahnrad im Benutzermenü; `/team` leitet weiter) | `TeamScreen` | `listTeam`; `GET /team` | | ✅ |
| Einladen (Admin) | Einladungsdialog | `InviteSheet` | `inviteMember` (Mail in Transaktion) | Mitglieder bekommen 403 | ✅ `api.test.ts` |
| Einladung erneut senden / widerrufen (Admin) | Liste | Swipe/Kontextmenü | `resendInvitation`, `revokeInvitation` | | ✅ Backend-Tests |
| Rolle ändern (Admin), letzter Admin geschützt | Menü | Kontextmenü „Rolle“ | `changeMemberRole` (Sperre der Admin-Zeilen) | `LAST_ADMIN` auf beiden Plattformen | ✅ `api.test.ts` |
| Mitglied entfernen (Admin) | Menü | Swipe/Kontextmenü | `removeMember` (+ Chat-Übergabe) | Zugriff sofort weg | ✅ E2E 7 |
| Eigenen Namen ändern | Benutzermenü | „Namen ändern“ | `updateOwnName` | | ✅ |
| „Files“: gemeinsamer Google-Drive-Ordner | Navigation, öffnet neuen Tab (`lib/external-links.ts`) | – (bewusst nicht angeboten) | keine (reiner Link) | | ✅ E2E `flow` |
| „Besprechung beitreten“: Discord-Sprachkanal (Admin hinterlegt den Link unter Einstellungen) | Navigation + Kopfzeile mobil; ohne Link: Admin → Einstellung, sonst „Nicht eingerichtet“ | **noch nicht in der UI** (`Viewer.meetingUrl`, `PUT /workspace/meeting-url`) | `workspace.ts` `updateMeetingUrl` (nur Admin, nur http(s)); `session.getViewerProfile` | Mitglieder sehen den Link, nur Admins ändern ihn | ✅ `task-links.test.ts`, `api.test.ts`, E2E `flow` · iOS offen |

## Kommunikation

| Funktion | Web (Bestand) | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Offene / geschlossene Kanäle, „Allgemein“ | Chatliste | `ChatListScreen` (Kanäle, DMs, Archiviert) | `listConversations`, `ensureDefaultChannel` | | ✅ |
| Kanal erstellen | Dialog | `NewChannelSheet` | `createChannel` (idempotent per Client-ID) | | ✅ E2E 6 |
| Kanalverwaltung (Name, Beschreibung, Archiv, Mitglieder, Verlassen mit Übergabe) | Details-Panel | `ConversationDetailsView` | `updateChannel`, `setChannelArchived`, `addChannelMembers`, `removeChannelMember` | Admin ohne Mitgliedschaft hat keinen Zugriff auf geschlossene Kanäle | ✅ `api.test.ts`, E2E 6 |
| Direktnachrichten | Dialog | `NewDirectMessageSheet` | `openDm` (genau eine pro Paar) | iOS-DM erscheint im Web als ungelesen | ✅ E2E 4 |
| Senden (idempotent), Bearbeiten, Löschen eigener Nachrichten | Composer, Menü | Composer über der Tastatur; Kontextmenü; fehlgeschlagene Nachricht mit „Erneut senden“ | `sendMessage` (Client-ID), `editMessage`, `deleteMessage` | keine Dubletten bei Wiederholung | ✅ E2E 4, 9 |
| Ungelesen-Markierung | Punkt an Navigation und Unterhaltung | Tab-Badge, Punkt in Liste | `conversation_read_states`; `markRead` nur vorwärts | Ungelesen-Zustand plattformübergreifend gleich | ✅ E2E 4 |
| Verlauf nachladen | Cursor `beforeSeq` | „Ältere Nachrichten“ oben, Scrollposition bleibt | `listMessages` (`beforeSeq`/`afterSeq`) | | ✅ `api.test.ts` |
| Dateianhänge (10 MB, 3 pro Nachricht, Allowlist, Budget) | Upload → Storage → Finalize | Fotos (HEIC → JPEG, ohne GPS) und Dateien (System-Picker); Öffnen/Teilen über Quick Look, nur auf Antippen | `chat-files.ts` (Reservierung, Signaturprüfung, Bereinigung, 60-s-Links) | iOS-Upload im Web öffnen und umgekehrt; Limits greifen für beide | ✅ E2E 5 |
| Speicherverbrauch (Admin) | Hinweis unten in der Chatliste | `StorageUsageRow` | `getChatStorageUsage` | | ✅ |
| Realtime | Supabase `postgres_changes` | gleiche Abonnements (`RealtimeHub`), Abbau im Hintergrund, Resync bei Vordergrund/Reconnect | RLS (`is_active_workspace_member`, `can_access_conversation`) | Änderungen erscheinen ohne Reload | ✅ E2E 2–4 (Web-Seite) · 🟡 iOS-Seite |

## Mitteilungen (nur iOS)

| Funktion | Web | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Push bei neuer Nachricht (DM, Kanal) | – (keine Web-Push) | APNs-Mitteilung; Antippen öffnet die Unterhaltung; kein Banner für die offene Unterhaltung | `services/notifications.ts` `notifyNewMessage` (aus `sendMessage`, nach Commit, nicht bei Wiederholungen); Empfänger = aktive Mitglieder mit Zugriff, ohne Absender | auch im Web gesendete Nachrichten lösen Push aus | ✅ Backend-Tests · ✅ Darstellung per `simctl push` · ⏳ echter APNs-Versand (Schlüssel fehlt) |
| Push bei neuer Aufgabe für mich | – | Mitteilung „Neue Aufgabe für dich“; Antippen öffnet die Aufgabe | `notifyAssignment` aus `createTask`, `updateTask`, `setTaskAssignee` (nur bei Wechsel, nicht bei Selbstzuweisung) | Zuweisung im Web oder auf iOS | ✅ Backend-Tests |
| Einstellungen: Direktnachrichten / Kanäle / Aufgaben | – | Tab „Einstellungen“ → Mitteilungen | `notification_preferences`; `GET/PATCH /me/notification-settings` | Auswahl gilt für alle Geräte | ✅ |
| Geräte | – | Registrierung nach Login, Abmeldung beim Logout | `push_devices`; `PUT/DELETE /devices/{token}`; von APNs abgelehnte Tokens werden gelöscht | Accountwechsel bekommt keine Mitteilungen des alten Kontos | ✅ Backend-Tests |

Einstellungen-Tab (iOS): Konto (Name ändern), Mitteilungen, Team (Mitglieder & Einladungen als Unterseite), Abmelden.

## Bewusst nicht enthalten (auch nicht im Web)

Web-Push, Offline-Synchronisierung, Task-Abhängigkeiten, Dark Mode (Web: nur hell; iOS folgt), Kommentare, Unteraufgaben. Push ist ein eigener Funktionsbereich und braucht einen eigenen Auftrag (APNs-Schlüssel, Gerätetokens, Versandlogik).
