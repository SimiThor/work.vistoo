# HTTP-API v1 (`/api/v1`)

Versionierte API für native Clients. Sie läuft in derselben Next.js-App auf Vercel wie das Web (`apps/web/src/app/api/v1/[...path]/route.ts`), die Logik liegt vollständig in `packages/backend/src/http`.

- **Vertrag (Quelle):** `packages/contracts/src/endpoints.ts`
- **OpenAPI 3.1 (generiert):** `packages/contracts/generated/openapi.json`, nicht von Hand ändern
- **Swift (generiert):** `apps/ios/Packages/VistooKit/Sources/VistooCore/Generated/`
- **Neu erzeugen:** `npm run generate`

Web-Server-Actions und API rufen dieselben Services auf. Native Clients hängen nicht vom internen Server-Action-Protokoll von Next.js ab.

## Authentifizierung

`Authorization: Bearer <Supabase Access Token>`. Der Server verifiziert die Signatur und das Ablaufdatum (`getClaims`) und schlägt danach bei **jeder** Anfrage die aktive Mitgliedschaft und Rolle in der Datenbank nach. IDs von Workspaces oder Benutzern in Requests verleihen keine Rechte.

| Stufe (`x-vistoo-auth`) | Bedeutung |
| --- | --- |
| `public` | ohne Token: `GET /meta`, `POST /auth/login-code` |
| `session` | gültiger Token, Mitgliedschaft nicht nötig: `GET /me`, `POST /invitations/accept` |
| `member` | aktives Mitglied |
| `admin` | aktives Mitglied mit Rolle Admin |

Login: `POST /auth/login-code` (gleiche Regel wie Web, inkl. „Einladung erneut senden“). Den Code oder Login-Link verifiziert der Client danach direkt bei Supabase Auth (`verifyOTP`). Die Session speichert iOS im Keychain.

Clients senden `X-Vistoo-Client: ios/<Build-Nummer>`. Ist der Build kleiner als `MIN_IOS_BUILD`, antwortet der Server mit `426 CLIENT_OUTDATED`.

## Fehler

```json
{ "error": { "code": "VALIDATION", "message": "Bitte gib einen Titel ein.", "fieldErrors": { "title": "…" } } }
```

| Code | HTTP | Bedeutung |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Token fehlt/ungültig/abgelaufen → einmal refreshen, sonst neu anmelden |
| `FORBIDDEN` | 403 | keine Berechtigung **oder** Mitgliedschaft beendet → `GET /me` klärt den Fall |
| `NOT_FOUND` | 404 | gibt es nicht **oder** kein Zugriff (absichtlich nicht unterscheidbar) |
| `VALIDATION` | 422 | Eingabe ungültig, `fieldErrors` je Feld |
| `CONFLICT` | 409 | Versionskonflikt (`error.current` = aktueller Stand) oder ID-Kollision |
| `ARCHIVED` | 409 | Projekt/Kanal archiviert bzw. Unterhaltung schreibgeschützt |
| `LAST_ADMIN` | 409 | letzter Admin kann nicht entfernt/herabgestuft werden |
| `RATE_LIMITED` | 429 | zu viele Login-Versuche |
| `CLIENT_OUTDATED` | 426 | App aktualisieren |
| `INTERNAL` | 500 | unerwartet; Request-Inhalte werden nicht geloggt |

`message` ist deutsch und für die Anzeige bestimmt. Unbekannte Codes behandeln Clients wie `INTERNAL`.

## Formate

- **Zeitpunkte:** ISO 8601 UTC mit Millisekunden, z. B. `2026-11-06T07:43:29.456Z`.
- **Kalendertage** (`startDate`, `endDate`): `YYYY-MM-DD`, ohne Zeitzone, nie umrechnen.
- **IDs:** UUID, kleingeschrieben.
- **Nullable:** Felder sind in Antworten immer vorhanden (`null` statt weglassen). In Patches gilt: **weglassen = unverändert**, `null` = leeren.
- **Enums:** offen. Unbekannte Werte müssen toleriert werden.
- **Listen** stecken in Objekten (`{ "tasks": [...] }`), damit sie später additiv erweitert werden können.

## Pagination

- Nachrichten: Cursor über `seq`. Ohne Parameter kommt die neueste Seite (50). `beforeSeq` liefert ältere Nachrichten, `afterSeq` alles Neuere (Resync, begrenzt; bei `hasMore` mit der letzten `seq` erneut abfragen). Die Ausgabe ist immer aufsteigend sortiert.
- Aufgaben, Projekte, Mitglieder: pro Workspace begrenzt, nicht paginiert.

## Wiederholungen, Idempotenz, Konflikte (`x-vistoo-retry`)

| Wert | Bedeutung für Clients |
| --- | --- |
| `safe` | darf nach Netzwerkfehlern automatisch wiederholt werden |
| `idempotent-with-client-id` | Client-ID (`id`) mitsenden; eine Wiederholung liefert den gespeicherten Datensatz |
| `check-conflict` | kann schon gewirkt haben: `CONFLICT`/`current` auswerten bzw. neu laden statt blind wiederholen |
| `not-found-means-done` | Löschen: `NOT_FOUND` bei Wiederholung heißt „bereits gelöscht“ |

Nachrichten werden per `PUT /conversations/{id}/messages/{messageId}` mit Client-ID gesendet und sind dadurch idempotent. Aufgaben-Updates nutzen `expectedVersion`. Liefert ein Konflikt in `current` bereits die gewünschten Werte, war der erste Versuch erfolgreich.

## Endpunkte (Kurzüberblick)

Die vollständige Liste mit Schemas steht in `openapi.json`. Gruppen: Meta/Session (`/meta`, `/auth/login-code`, `/me`, `/invitations/accept`, `/bootstrap`, `/me/profile`), Tasks (`/tasks…`, Anhänge `/tasks/{id}/links`, `/task-links/{id}`), Projekte und Gruppen (`/projects…`, `/groups/{id}`), Team (`/team`, `/invitations…`, `/members/{userId}…`, `/workspace/meeting-url`), Chat (`/conversations…`, `/messages/{id}`), Dateien (`/conversations/{id}/uploads`, `/uploads/{id}…`, `/attachments/{id}/download`, `/chat/storage`).

## Neuen Endpunkt hinzufügen

1. Service-Funktion in `packages/backend/src/services` (bzw. vorhandene nutzen) und Tests ergänzen.
2. Eintrag in `packages/contracts/src/endpoints.ts`: Request-/Response-Schemas mit `req()`/`res()` benennen, `errors` und `retry` angeben.
3. Handler in `packages/backend/src/http/handlers.ts` (eine Zeile, ruft den Service). Fehlt er, schlagen TypeScript und der Test „has a handler for every endpoint“ fehl.
4. `npm run generate` und anschließend `npm test`.
