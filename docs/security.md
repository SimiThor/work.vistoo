# Sicherheit

Kurzüberblick über das Schutzmodell von Vistoo Work, die Bewertung zusätzlicher Verschlüsselung und die manuellen Schritte pro Umgebung. Stand: Security-Audit November 2026.

## Schutzmodell

| Ebene | Mechanismus | Wo |
| --- | --- | --- |
| Identität | Supabase Auth (Magic Link/OTP, keine öffentliche Registrierung). JWT wird bei jeder Anfrage verifiziert (`getClaims`), danach wird die **aktive Mitgliedschaft frisch** nachgeschlagen. | `packages/backend/src/auth.ts`, `apps/web/src/server/auth.ts` |
| Autorisierung | Alle Lese- und Schreibzugriffe laufen über die Services. Jede Abfrage ist an `ctx.workspaceId` gebunden; fremde IDs verhalten sich wie nicht vorhandene. Private Kanäle/DMs nur für Teilnehmer, To-dos nur für den Besitzer. | `packages/backend/src/services/*` |
| Data API / Realtime | RLS auf **allen** Tabellen. `anon`: keine Rechte. `authenticated`: nur SELECT, gefiltert auf aktive Mitglieder bzw. Teilnehmer/Besitzer. Keine Schreib-Policies. Storage-Bucket privat, Downloads nur per 60-s-Link nach Prüfung. | `packages/database/migrations/*_security.sql` |
| Regressionstest | `packages/backend/tests/security.test.ts` prüft strukturell für alle (auch künftige) Tabellen: RLS an, keine `anon`-Rechte, nur SELECT für `authenticated`, jede Policy an den Aufrufer gebunden, Realtime-Tabellen geschützt, SECURITY-DEFINER-Funktionen gehärtet, keine Workspace-übergreifende Sichtbarkeit. Das Test-Setup vergibt neue Objekte wie Supabase automatisch an `anon`/`authenticated`. Ein vergessenes `REVOKE` fällt deshalb auf. | |
| Frontend | React escaped alle Inhalte. Markdown ohne Raw-HTML (`skipHtml`), URL-Filter gegen `javascript:`/`data:`. Links nur http(s) (serverseitig validiert), extern mit `noopener noreferrer`. | `components/markdown`, `packages/domain/src/links.ts` |
| Header | `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, Basis-CSP (`frame-ancestors`, `base-uri`, `object-src`, `form-action`). | `apps/web/next.config.ts` |

**Neue Tabelle?** Immer in derselben Migrationsrunde eine `*_security.sql` mit `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon, authenticated` und, nur falls Realtime sie braucht, `GRANT SELECT` + eine an den Aufrufer gebundene Policy. `security.test.ts` erzwingt das.

## Verschlüsselung

| Art | Status |
| --- | --- |
| **In Transit: Browser/App ↔ Vercel, ↔ Supabase** | HTTPS/TLS (Vercel, Supabase), HSTS gesetzt. iOS nur HTTPS (ATS). |
| **In Transit: Vercel ↔ Postgres** | Seit dem Audit **TLS mit Zertifikatsprüfung** gegen die Supabase Root 2021 CA (`packages/database/src/tls.ts`). Vorher unverschlüsselt: `postgres.js` nutzt ohne Konfiguration kein TLS, und die URLs enthielten kein `sslmode`. Gilt für App, Migrationen und Skripte. |
| **At Rest** | Supabase/AWS verschlüsselt Datenbank-Volumes, Backups und Storage (AES-256). Schützt gegen Datenträger-Diebstahl, **nicht** gegen jemanden mit Datenbank-Zugang oder gültiger Session. |
| **Application-Level** | Bewusst nicht eingeführt (siehe unten). |
| **Ende-zu-Ende** | Nicht vorhanden und nicht geplant. |

### Warum keine zusätzliche Feld-Verschlüsselung (Chat, Issues, CRM …)

Die realistischen Angriffswege für ein kleines internes Team sind: gestohlene Session/Login, Fehler in der Autorisierung, geleakte Server-Secrets und Fehlkonfigurationen der Data API. Feld-Verschlüsselung mit einem Server-Schlüssel hilft gegen **keinen** davon:

- Eine gültige Session bekommt Klartext, denn der Server entschlüsselt für jeden berechtigten Nutzer.
- Wer `DATABASE_URL` oder den Service-Role-Key aus Vercel hat, hat dort auch den Schlüssel.
- Data-API-Zugriff ist bereits durch RLS abgeriegelt, und das ist jetzt per Test abgesichert.

Sie würde nur einen schmalen Fall abdecken: Jemand liest die Datenbank, ohne an die Vercel-Umgebung zu kommen, zum Beispiel über ein geleaktes DB-Passwort oder einen Supabase-Dashboard-Zugang. Dem stünden spürbare Kosten gegenüber. Volltextsuche, Filter, `#123`-Referenzen, @Mentions, Push-Vorschauen und Realtime arbeiten heute direkt auf den Spalten. Dazu kämen eine Datenmigration aller Bestandsdaten und eine Schlüsselrotation mit Neu-Verschlüsselung. Diesen Aufwand halten wir aktuell nicht für gerechtfertigt. Wirksamer ist es, die genannten Zugänge zu schützen (siehe „Manuelle Schritte“).

**E2E** würde serverseitige Suche, Mentions, Benachrichtigungen, Push-Texte und Realtime-Vorschauen unmöglich machen und Schlüsselverwaltung auf jedem Gerät verlangen. Für interne Zusammenarbeit lohnt sich das nicht.

**Falls später nötig** (z. B. für einzelne hochsensible CRM-Notizen): AES-256-GCM aus `node:crypto` im Service-Layer, Schlüssel als Vercel-Secret (`FIELD_ENCRYPTION_KEYS`, mit Key-ID-Präfix pro Wert für Rotation). Nur für Felder, die nicht durchsucht werden.

### Bekannte Klartext-Kopien außerhalb der Datenbank

- **Push-Benachrichtigungen (iOS):** Titel und die ersten Zeichen der Nachricht gehen über Apple (APNs) und erscheinen auf dem Sperrbildschirm. Pro Nutzer abschaltbar (Benachrichtigungseinstellungen).
- **E-Mails** (Login/Einladung) enthalten keine Inhalte.

## Manuelle Schritte pro Umgebung (Supabase-Dashboard / Vercel)

1. **Supabase → Database → SSL Configuration: „Enforce SSL on incoming connections“ aktivieren.** Die App verschlüsselt jetzt selbst, die Erzwingung schützt zusätzlich vor falsch konfigurierten Clients. Erst nach dem Deployment der TLS-Änderung einschalten.
2. **Auth-Einstellungen wie in `supabase/config.toml`:** Sign-ups aus, anonyme Logins aus, Refresh-Token-Rotation an, „Secure email change“ (Bestätigung an alter und neuer Adresse) an. Wichtig, weil Einladungen über die E-Mail im JWT zugeordnet werden.
3. **Redirect-URLs** nur für die eigene Domain (`/auth/confirm`, `/auth/ios/confirm`).
4. **MFA für alle Supabase- und Vercel-Konten** des Teams. Über diese Konten kommt man an alle Daten und Secrets.
5. **Secrets** (`SUPABASE_SECRET_KEY`, `DATABASE_URL`, `CRON_SECRET`, APNs-Key) nur als Vercel-Umgebungsvariablen ohne `NEXT_PUBLIC_`-Präfix. Bei Verdacht oder Personalwechsel rotieren: Supabase → API Keys (neuen Secret Key erzeugen, in Vercel setzen, redeployen, alten löschen); DB-Passwort unter Database Settings zurücksetzen und `DATABASE_URL`/`DIRECT_DATABASE_URL` anpassen.
6. **Supabase Root CA**: gültig bis 26.04.2031. Wechselt Supabase vorher die CA, bricht die DB-Verbindung mit einem Zertifikatsfehler ab. Dann die neue CA aus dem Dashboard als `DATABASE_SSL_CA` setzen (sofortige Abhilfe, kein Code-Deployment nötig) und `SUPABASE_ROOT_CA_2021` in `tls.ts` ersetzen.
