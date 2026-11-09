# Funktionsmatrix Web ↔ iOS

Quelle des Funktionsumfangs ist die bestehende Webapp. Jede Zeile nennt die Web-Umsetzung, die iOS-Darstellung, die **eine** gemeinsame Backend-Logik und ein prüfbares Fertigstellungskriterium. Status: ✅ umgesetzt und automatisch geprüft · 🟡 umgesetzt, aber nur kompiliert/unit-getestet (iOS-UI ohne Simulatorlauf, siehe [verification.md](verification.md)).

Pfade: Web `apps/web/src`, iOS `apps/ios/Packages/VistooKit/Sources`, Backend `packages/backend/src/services`, Vertrag `packages/contracts/src/endpoints.ts`.

## Anmeldung und Zugang

| Funktion | Web (Bestand) | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Login per E-Mail-Code / Magic Link, keine Registrierung | `app/login`, `actions/auth.ts` | `SignInView` (E-Mail → Code, Auto-Fill), Universal Link `/auth/ios/confirm` | `services/login.ts` `requestLoginCode` (inkl. „eingeladen, nicht bestätigt → Einladung erneut senden“); `POST /auth/login-code` | gleicher Account meldet sich auf beiden Plattformen an; unbekannte Adressen sind nicht unterscheidbar | ✅ E2E `cross-platform` 1 · 🟡 UI |
| Einladung annehmen | `/invite` | `OnboardingView` | `services/invitations.ts` `acceptInvitation`; `GET /me`, `POST /invitations/accept` | nur offene, gültige Einladung an die verifizierte Adresse; abgelaufen → Hinweis | ✅ Backend-Tests · 🟡 UI |
| Kein Zugang / abgelaufen | `/invite` | `OnboardingView` (Zustände none/expired) | `services/session.ts` `getMe` | `GET /me` liefert `access` ohne Workspace-Daten | ✅ `api.test.ts` |
| Abmelden | Benutzermenü | Avatar oben links → Einstellungen → Abmelden | Supabase Auth | Keychain-Session, Realtime-Kanäle, Downloads und Stores werden entfernt | 🟡 (`AppModel.signOut`) |
| Zugriffsentzug bei laufender Session | jede Anfrage prüft Mitgliedschaft | jede API-Anfrage prüft Mitgliedschaft; 403 → `/me` → Onboarding | `auth.ts` `resolveMembership` pro Request; RLS für Realtime | entferntes Mitglied bekommt sofort 403 bzw. keine Events | ✅ E2E 7, `api.test.ts` |

## Projektmanagement

| Funktion | Web (Bestand) | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Projekte ansehen (aktiv/archiviert, Fortschritt) | `/projects` | `ProjectsScreen` (Sektionen, „x/y erledigt“) | `projects.listProjects`, `projectStats`; `GET /projects` | gleiche Liste/Zahlen | ✅ API · 🟡 UI |
| Projekt erstellen / bearbeiten (Name, Beschreibung, Farbe) | `project-dialog.tsx` | `ProjectEditor` (Sheet, Farbraster) | `createProject` (idempotent per Client-ID), `updateProject` | iOS-Projekt erscheint im Web | ✅ E2E 2 |
| Archivieren / Wiederherstellen (archiviert = schreibgeschützt) | `project-actions.tsx` | Swipe, Kontextmenü, Projektmenü | `setProjectArchived`; Guard `getWritableProject` | Schreibversuche auf archivierte Projekte → `ARCHIVED` | ✅ `api.test.ts` |
| Aufgabe erstellen (übernimmt eindeutige Filterwerte) | Quick-Add, Panel | `TaskCreateView` (Sheet), Regel aus `WorkScreen.newTask` | `createTask` (idempotent per Client-ID) | Wiederholung nach Netzfehler erzeugt keine Dublette | ✅ E2E 9 |
| Aufgabe bearbeiten (Titel, Beschreibung, Status, Projekt, Person, Termine) | `task-panel.tsx` | `TaskDetailView` (Form, native Picker/DatePicker) | `updateTask` mit `expectedVersion`; Konflikt → `current` | Web-Aufgabe auf iOS bearbeiten, Web aktualisiert live | ✅ E2E 2 |
| Issue-Nummer `#42` (fortlaufend pro Workspace, unveränderlich, nie wiederverwendet) | Karte, Timeline, Panel-Kopf (Klick kopiert), Ideen, Entscheidungen; Suche `#42`/`42` | Karte, Timeline, Detail-Titel; Filtersuche `#42` | `TaskSchema.number`, Vergabe per DB-Trigger (`0016`/`0017`); Suche `searchIssues` | Nummer auf beiden Plattformen identisch | ✅ `task-numbers.test.ts`, Filter-Fixtures |
| Meilensteine (workspaceweit; anlegen, bearbeiten, abschließen, löschen – Aufgaben bleiben; Fortschritt; Aufgaben aus allen Projekten zuordnen) | Seitenleiste, `/milestones`, `/milestones/[id]`, Feld im Aufgabenpanel | Mehr → `MilestonesScreen`/`MilestoneDetailScreen` (Fortschritt, Aufgaben aller Projekte, Abschließen, Löschen); Picker „Meilenstein“ im Aufgabenformular | `services/milestones.ts`; API `/milestones`, `GET /tasks?milestoneId=` | | ✅ `milestones.test.ts`, E2E `workspace` |
| Beschreibung als Markdown (GFM: Überschriften, Listen, Tabellen, Code mit Highlighting, Links) mit „Schreiben“/„Vorschau“, Toolbar, Kürzeln (⌘B/I/K/E, ⌘⇧7/8/L, ⌘⇧P) | `markdown/markdown-editor.tsx`, Ansicht `markdown/markdown-view.tsx` im Panel (rohes HTML wird nie gerendert, unsichere URLs entfernt) | **noch nicht** (zeigt den Quelltext) | Speicherung unverändert als Text in `tasks.description` (keine Migration) | bestehende Beschreibungen bleiben unverändert | ✅ E2E `markdown.spec.ts` · iOS offen |
| Checklisten in der Beschreibung direkt abhaken (`- [ ]` ↔ `- [x]`, auch verschachtelt), unabhängig vom Status | Checkboxen in der gerenderten Ansicht, sofort gespeichert | **noch nicht in der UI** (Endpunkt generiert) | `setTaskChecklistItem` (Zeilensperre, wirkt auf die aktuelle Beschreibung, ändert genau ein Zeichen, Punkt per Index + Text identifiziert; sonst `CONFLICT` + `current`); Parser `packages/domain/src/markdown.ts`; `PUT /tasks/{id}/checklist` | gleichzeitige Änderungen gehen nicht verloren | ✅ `markdown.test.ts`, `tasks.test.ts`, `api.test.ts`, E2E · iOS offen |
| Versionskonflikt | Hinweis „Aktuelle Version laden / Trotzdem speichern“ | gleicher Dialog als Alert | `CONFLICT` + `error.current` | identisches Verhalten | ✅ `api.test.ts` · 🟡 UI |
| Aufgabe löschen | Kartenmenü, Panel | Swipe, Kontextmenü, Detail | `deleteTask` (404 bei Wiederholung = erledigt) | | ✅ `api.test.ts` |
| Kanban mit Statuswechsel | Board (dnd-kit, Tastatur, Menü) | `BoardView`: Statusauswahl + Spaltenliste; Swipe „Weiter“, Kontextmenü „Status ändern“ | `setTaskStatus`, `moveTask` | Statuswechsel auf iOS erscheint im Web und umgekehrt | ✅ E2E 3 |
| Gespeicherte Reihenfolge | Drag & Drop zwischen sichtbare Nachbarn | „Sortieren“ (Drag-Griffe) + Kontextmenü „Reihenfolge“ + VoiceOver-Aktionen | `moveTask` (fraktionale Positionen, Renormalisierung) | gleiche Platzierungsregel | ✅ `tasks.test.ts`, `api.test.ts` · 🟡 UI |
| Zuweisen | Kartenmenü, Panel | Kontextmenü „Zuweisen“, Detail | `setTaskAssignee` (nur aktive Mitglieder) | | ✅ |
| Timeline/Gantt (Tag/Woche, Heute, nicht geplante Aufgaben) | `timeline.tsx` | `TimelineView`: horizontale Achse, Namen über dem Balken links angeheftet, Zoom + „Heute“ unten, Tippen → Detail mit DatePickern | Kalendertage ohne Zeitzone (`CalendarDate` ↔ `dates.ts`) | iOS-Termine erscheinen exakt im Web | ✅ E2E 3, `DateTests` · 🟡 UI |
| Suche und Filter (Projekt, Meilenstein, Person; Status nur iOS; OR/AND) | Filterleiste, URL (Status nicht angeboten) | `.searchable` + `FilterSheet` | Semantik `packages/domain/src/filters.ts`; Fixtures `packages/contracts/fixtures/task-filters.json` | gemeinsame Fälle grün in TS **und** Swift | ✅ |
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
| „Besprechung beitreten“: Discord-Sprachkanal (Admin hinterlegt den Link unter Einstellungen) | Navigation + Kopfzeile mobil; ohne Link: Admin → Einstellung, sonst „Nicht eingerichtet“ | Mehr → „Besprechung beitreten“ (nur wenn ein Link hinterlegt ist; Ändern bleibt im Web) | `workspace.ts` `updateMeetingUrl` (nur Admin, nur http(s)); `session.getViewerProfile` | Mitglieder sehen den Link, nur Admins ändern ihn | ✅ `task-links.test.ts`, `api.test.ts`, E2E `flow` · iOS: nur Beitreten |

## Persönliche Organisation, Ideen, CRM

Web und iOS über dieselben Services; die Fachregeln liegen vollständig im Backend. iOS: eigene To-dos direkt auf **Für mich** (Abschnitt „Meine To-dos“ mit Eingabefeld), alles Weitere im Tab **Mehr**. API: `/todos…`, `/ideas…`, `/attractions…`, `/activities/{id}` (`api.test.ts`). iOS-Abläufe: UI-Test `WorkspaceAreasTests` gegen den lokalen Stack.

| Funktion | Web | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Meine To-dos: private Checkliste (hinzufügen, bearbeiten, abhaken/wieder öffnen, löschen, sortieren, Fälligkeit) | `/todos`, `todos/todo-list.tsx` | Für mich → „Meine To-dos“ (Eingabefeld, Abhaken per Tippen/Swipe, erste 6 offene) und `TodosScreen` (alle, Erledigt, Sortieren per Ziehen, Bearbeiten-Sheet) | `services/todos.ts` (immer auf eigene `user_id` begrenzt, Client-ID, max. 500); RLS: nur Besitzer | andere Mitglieder – auch Admins – sehen nichts | ✅ `todos.test.ts`, E2E `workspace` |
| Ideen: gemeinsamer Backlog (Status Neu/Geplant/Irrelevant, Suche, Filter, Sortierung, Verantwortlich) | `/ideas`, `ideas/*` | Mehr → `IdeasScreen` (Suche, Status-Filter, Sortierung, Swipe Löschen), `IdeaDetailScreen` | `services/ideas.ts` (Teil-Updates, aktive Mitglieder als Verantwortliche) | alle aktiven Mitglieder sehen und bearbeiten | ✅ `ideas.test.ts`, E2E `workspace` |
| Idee → Issue | Projekt wählen + „Issue erstellen“ im Detail; öffnet die Aufgabe | `createIssueFromIdea` nutzt `tasks.insertTask` in derselben Transaktion; Verknüpfung `ideas.task_id` (wird beim Löschen der Aufgabe geleert) | Wiederholung liefert dasselbe Issue | ✅ `ideas.test.ts`, E2E `workspace` |
| CRM: Attraktionen (Tabelle, Kennzahlen, Suche, Filter Status/Person/überfällig, Sortierung, Status in der Tabelle) | Mehr → `CRMScreen` (Kennzahlen, Suche, Filter Status/Person/überfällig, Sortierung) | `services/crm.ts` | | ✅ `crm.test.ts`, E2E `workspace` |
| CRM: automatischer Verlauf (angelegt, Status, Verantwortlich, Follow-up) | `AttractionDetailScreen` → „Verlauf“ | im selben Transaktionsschritt unter Zeilensperre; nur echte Änderungen; System-Einträge unveränderlich (Service + Trigger) | genau ein Eintrag pro Änderung, auch bei parallelen Anfragen | ✅ `crm.test.ts` |
| CRM: manuelle Aktivitäten (Anruf, E-Mail, Meeting, Notiz; optional Follow-up) | „Aktivität hinzufügen“ (Art, Zeitpunkt, optional Follow-up); Bearbeiten/Löschen per Swipe (nur angezeigt für Autor/Admin) | `addActivity`/`updateActivity`/`deleteActivity` (Autor oder Admin); „Letzter Kontakt“ aus Anruf/E-Mail/Meeting | Follow-up und letzter Kontakt aktualisieren sich | ✅ `crm.test.ts`, E2E `workspace` |

## Decisions (Entscheidungen & Experimente)

Web und iOS (Mehr → Entscheidungen) über dieselben Services und `/decisions…`, `/decision-links/{id}`, `/decision-relations/{id}`. Fachregeln liegen vollständig im Backend (`services/decisions.ts`) und als Absicherung in CHECK-Constraints (Migrationen `0014_decisions`, `0015_decisions_security`).

| Funktion | Web | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Erfassen in Sekunden: Typ (Decision/Experiment) + Titel, Enter (⌘↵ öffnet direkt) | `/decisions`, `decisions/decisions-view.tsx` | „+“ → Typ + Titel, öffnet danach das Detail | `createDecision` (nur Titel Pflicht, Client-ID, Startstatus je Typ) | alle aktiven Mitglieder sehen und bearbeiten | ✅ `decisions.test.ts`, E2E `decisions` |
| Status je Typ: Open/In Discussion/Decided/Superseded bzw. Planned/Testing/Adopted/Rejected/Inconclusive | `DecisionDetailScreen`: Status-Picker nur mit Status des Typs | `updateDecision` (Status passt zum Typ, sonst Fehler; CHECK `decisions_status_matches_type`) | | ✅ `decisions.test.ts`, Domain-Test |
| Abschluss nur mit Ergebnis (Decision: Entscheidung + Begründung; Experiment: nur Ergebnis – Experimente haben nur Beschreibung + Ergebnis); Entscheidungs-/Abschlussdatum automatisch (Team-Zeitzone), änderbar | Felder je Typ; fehlende Pflichtfelder als Feldfehler (lokale Vorprüfung + `fieldErrors` des Servers) | `completionErrors` (Domain) + Service + CHECK `decisions_concluded_complete` | Server lehnt unvollständige Abschlüsse ab, auch ohne UI | ✅ `decisions.test.ts`, E2E `decisions` |
| Nachvollziehbarkeit: Verlauf für abgeschlossene Einträge (wer, wann, welche Felder, vorherige Fassung; Abschluss, Wiederöffnen, Ersetzen) | Abschnitt „Verlauf“ (vorherige Fassung aufklappbar) | im selben Transaktionsschritt unter Zeilensperre; nur echte Änderungen; `decision_history` unveränderlich (Trigger) | | ✅ `decisions.test.ts`, E2E `decisions` |
| „Ersetzen“: neue oder bestehende Entscheidung; alte bleibt vollständig, wird Superseded und verweist auf die neue (Rückverweis abgeleitet) | „Durch neue Entscheidung ersetzen …“ (neu oder bestehend), Hinweise „Ersetzt durch“/„Ersetzt“ | `supersedeDecision` (nur Decided, keine Zyklen, idempotent); Löschen der neuen macht die alte wieder gültig | | ✅ `decisions.test.ts`, E2E `decisions` |
| Suche (Titel, Kontext, Optionen, Ergebnisse, Entscheidung, Begründung …), Filter Typ/Status/Person, Sortierung (zuletzt geändert, erstellt) | `.searchable` (Serversuche) + Filtermenü Typ/Status/Person/Sortierung | `listDecisions`: Postgres-Volltext (`tsvector` 'simple', GIN-Index, Präfixsuche) | | ✅ `decisions.test.ts`, E2E `decisions` |

## Kommunikation

| Funktion | Web (Bestand) | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| `#`-Referenzen auf Aufgaben (gespeichert als `<#task-id>`, Nummer/Titel/Status pro Leser aufgelöst) | `#` im Composer öffnet dieselbe Liste wie `@` (Nummer + Titel, Tastatur/Maus); `#24` als Link → `/tasks?task=`, Hover zeigt Titel + Status | zeigt `body` mit `#24` als Text | `searchIssues` (`GET /issue-refs`), `MessageSchema.issueRefs`; send/edit prüfen neue Referenzen auf den eigenen Workspace | gelöschte Aufgaben → „#gelöschte Aufgabe“ | ✅ `issue-refs-chat.test.ts`, E2E `chat-issue-refs.spec.ts` |
| Offene / geschlossene Kanäle, „Allgemein“ | Chatliste | `ChatListScreen` (Kanäle, DMs, Archiviert) | `listConversations`, `ensureDefaultChannel` | | ✅ |
| Kanal erstellen | Dialog | `NewChannelSheet` | `createChannel` (idempotent per Client-ID) | | ✅ E2E 6 |
| Kanalverwaltung (Name, Beschreibung, Archiv, Mitglieder, Verlassen mit Übergabe) | Details-Panel | `ConversationDetailsView` | `updateChannel`, `setChannelArchived`, `addChannelMembers`, `removeChannelMember` | Admin ohne Mitgliedschaft hat keinen Zugriff auf geschlossene Kanäle | ✅ `api.test.ts`, E2E 6 |
| Direktnachrichten | Dialog | `NewDirectMessageSheet` | `openDm` (genau eine pro Paar) | iOS-DM erscheint im Web als ungelesen | ✅ E2E 4 |
| Senden (idempotent), Bearbeiten, Löschen eigener Nachrichten | Composer, Menü | Composer über der Tastatur; Kontextmenü; fehlgeschlagene Nachricht mit „Erneut senden“ | `sendMessage` (Client-ID), `editMessage`, `deleteMessage` | keine Dubletten bei Wiederholung | ✅ E2E 4, 9 |
| Ungelesen-Markierung | Punkt an Navigation und Unterhaltung | Tab-Badge, Punkt in Liste | `conversation_read_states`; `markRead` nur vorwärts | Ungelesen-Zustand plattformübergreifend gleich | ✅ E2E 4 |
| Verlauf nachladen | Cursor `beforeSeq` | „Ältere Nachrichten“ oben, Scrollposition bleibt | `listMessages` (`beforeSeq`/`afterSeq`) | | ✅ `api.test.ts` |
| Dateianhänge (10 MB, 3 pro Nachricht, Allowlist, Budget) | Upload → Storage → Finalize | Fotos (HEIC → JPEG, ohne GPS) und Dateien (System-Picker); Öffnen/Teilen über Quick Look, nur auf Antippen | `chat-files.ts` (Reservierung, Signaturprüfung, Bereinigung, 60-s-Links) | iOS-Upload im Web öffnen und umgekehrt; Limits greifen für beide | ✅ E2E 5 |
| Speicherverbrauch (Admin) | Hinweis unten in der Chatliste | `StorageUsageRow` | `getChatStorageUsage` | | ✅ |
| @Erwähnungen | `@` im Composer und beim Bearbeiten öffnet Vorschläge am Cursor (Vor-/Nachname, Pfeiltasten, Enter/Tab, Esc, Maus/Touch); Erwähnung ist ein Block; dezente Hervorhebung, eigene Erwähnung mit Randmarkierung; `@all` als eigener Vorschlag (bei leerem `@` am Listenende) benachrichtigt alle in der Unterhaltung und markiert die Nachricht bei allen | ⏳ noch keine Eingabe; Nachrichten zeigen `body` lesbar („@Name“), Push-Vorschau ebenso | Speicherung als Token `<@user-id>` bzw. `<@all>` im Text (`@vistoo/domain/mentions`); `<@all>` löst der Server beim Senden/Bearbeiten in alle Lesenden auf (offener Kanal: aktive Mitglieder, sonst Teilnehmende), zählt nicht zum Erwähnungslimit, erneutes Speichern benachrichtigt nicht doppelt; `sendMessage`/`editMessage` prüfen jede neu hinzugefügte Erwähnung gegen den Zugriff auf die Unterhaltung (offener Kanal: aktive Mitglieder, sonst Teilnehmende); API liefert `markup` + `mentionIds` additiv | Namensänderung wirkt rückwirkend; manipulierte Erwähnung Unbeteiligter → `VALIDATION` | ✅ `mentions.test.ts` (Domain + Backend), E2E `chat-mentions.spec.ts`, Cross-Platform 10 |
| Realtime | Supabase `postgres_changes` | gleiche Abonnements (`RealtimeHub`), Abbau im Hintergrund, Resync bei Vordergrund/Reconnect | RLS (`is_active_workspace_member`, `can_access_conversation`) | Änderungen erscheinen ohne Reload | ✅ E2E 2–4 (Web-Seite) · 🟡 iOS-Seite |

## Mitteilungen

| Funktion | Web | iOS | Gemeinsame Logik | Fertig, wenn … | Status |
| --- | --- | --- | --- | --- | --- |
| Push bei neuer Nachricht (DM, Kanal) | – (keine Web-Push) | APNs-Mitteilung; Antippen öffnet die Unterhaltung; kein Banner für die offene Unterhaltung | `services/notifications.ts` `notifyNewMessage` (aus `sendMessage`, nach Commit, nicht bei Wiederholungen); Empfänger = aktive Mitglieder mit Zugriff, ohne Absender | auch im Web gesendete Nachrichten lösen Push aus | ✅ Backend-Tests · ✅ Darstellung per `simctl push` · ⏳ echter APNs-Versand (Schlüssel fehlt) |
| Push bei neuer Aufgabe für mich | – | Mitteilung „Neue Aufgabe für dich“; Antippen öffnet die Aufgabe | `notifyAssignment` aus `createTask`, `updateTask`, `setTaskAssignee` (nur bei Wechsel, nicht bei Selbstzuweisung) | Zuweisung im Web oder auf iOS | ✅ Backend-Tests |
| Einstellungen: Direktnachrichten / Kanäle / Aufgaben | – | Avatar oben links → Einstellungen → Mitteilungen | `notification_preferences`; `GET/PATCH /me/notification-settings` | Auswahl gilt für alle Geräte | ✅ |
| In-App-Mitteilungen bei Erwähnung | Glocke in Seitenleiste/Kopfzeile mit Zähler; Klick öffnet die Unterhaltung an der Nachricht | ⏳ Endpunkte vorhanden (`GET /me/notifications`, `POST /me/notifications/read`), noch keine Oberfläche | `notifications`-Tabelle (persistent, eindeutig pro Nachricht+Person); `services/inbox.ts`: keine Selbst-Erwähnung, keine Dubletten (auch nicht bei Wiederholung/Bearbeiten), entfernte Erwähnung/gelöschte Nachricht löscht den Eintrag, `markRead` liest mit; RLS: nur eigene Zeilen bei Zugriff auf die Unterhaltung | Erwähnte Person sieht genau einen Eintrag „X hat dich in #Kanal erwähnt“ | ✅ Backend-Tests, E2E `chat-mentions.spec.ts`, Cross-Platform 10 |
| Geräte | – | Registrierung nach Login, Abmeldung beim Logout | `push_devices`; `PUT/DELETE /devices/{token}`; von APNs abgelehnte Tokens werden gelöscht | Accountwechsel bekommt keine Mitteilungen des alten Kontos | ✅ Backend-Tests |

Einstellungen (iOS, hinter dem Avatar oben links in jedem Tab): Konto (Name ändern), Mitteilungen, Team (Mitglieder & Einladungen als Unterseite), Chat-Speicher (Admins), Abmelden.

iOS-Navigation: Tabs **Für mich** (ungelesene Unterhaltungen, eigene To-dos mit Eingabefeld, eigene offene Aufgaben nach Dringlichkeit; „+“ = neues To-do oder neue Aufgabe; Badge = überfällige eigene Aufgaben + überfällige To-dos), **Aufgaben** (Team, Board/Zeitachse), **Projekte**, **Chat**, **Mehr** (Meine To-dos, Meilensteine, Ideen, Entscheidungen, CRM, Besprechung beitreten). Reine Darstellung, keine eigene Fachregel: „überfällig“ = Enddatum vor heute und nicht erledigt.

## Bewusst nicht enthalten (auch nicht im Web)

Web-Push, Offline-Synchronisierung, Task-Abhängigkeiten, Dark Mode (Web: nur hell; iOS folgt), Kommentare, Unteraufgaben. Push ist ein eigener Funktionsbereich und braucht einen eigenen Auftrag (APNs-Schlüssel, Gerätetokens, Versandlogik).

## Entfernt

| Funktion | Stand |
| --- | --- |
| Projekt-Gruppen | Am 2026-11-09 vollständig entfernt (Web, iOS, Backend, Migration `0019_remove_groups` löscht `project_groups` und `tasks.group_id` samt Daten). API v1 liefert `Task.groupId` weiter als `null` und `Project.groups` als `[]`, damit ältere iOS-Builds weiter dekodieren. Die Gruppen-Endpunkte (`/projects/{id}/groups`, `/groups/{id}`) gibt es nicht mehr: Ältere Builds bekommen beim Verwalten von Gruppen „Unbekannter Endpunkt“; ein gesendetes `groupId` wird ignoriert. |


## Android

Die Android-App (`apps/android`) setzt den Funktionsumfang der iOS-Spalte vollständig um und nutzt dieselben Endpunkte; es gibt keine Android-spezifische Backend-Logik. Abweichungen sind rein plattformbedingt (Swipe-/Sortier-Bedienung, Dateiansicht über das System) und in [apps/android/README.md](../../apps/android/README.md) aufgeführt.

| Bereich | Android | Status |
| --- | --- | --- |
| Anmeldung (Code), Session, Abmelden | `SignInScreen`, `AuthService`, `SecureSessionStore` | ✅ Emulator gegen lokalen Stack (Code aus Mailpit, Kaltstart mit gespeicherter Session) |
| Für mich, To-dos | `HomeScreen`, `TodosScreen` | ✅ Emulator (To-do angelegt, serverseitig gespeichert) |
| Aufgaben: Board, Detail, Bearbeiten mit Version | `WorkScreen`, `BoardView`, `TaskDetailView` | ✅ Emulator (Beschreibung gespeichert, Version erhöht) |
| Zeitachse | `TimelineView` | ✅ Emulator (Darstellung) |
| Realtime (Tasks) | `RealtimeHub` | ✅ Emulator (DB-Änderung erscheint ohne Neuladen) |
| Chat: Senden, Links | `ConversationScreen` | ✅ Emulator · Anhänge 🟡 (kompiliert, nicht manuell geprüft) |
| Ideen, Entscheidungen, CRM (anlegen, Follow-up) | `ideas/`, `decisions/`, `crm/` | ✅ Emulator |
| Einstellungen, Team | `SettingsSheet`, `TeamScreen` | ✅ Emulator (Darstellung) |
| Offline-Hinweis, Rotation | `OfflineBanner`, `AppViewModel` | ✅ Emulator |
| Filtersemantik | `TaskFilters` | ✅ `TaskFilterConformanceTest` (gemeinsame Fixtures) |
| Push-Mitteilungen | – | offen: Backend sendet nur APNs (FCM nötig) |
| Markdown-Ansicht, Checklisten abhaken | – | offen (wie iOS) |
