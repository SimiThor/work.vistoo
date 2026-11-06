# Kompatibilität und Release-Reihenfolge

Installierte iOS-Versionen bleiben oft Wochen oder Monate im Einsatz. Web und Backend werden dagegen bei jedem Merge auf `main` neu ausgerollt. Ein normales Web-Deployment darf eine nicht aktualisierte App deshalb nie unbrauchbar machen.

## Regeln für `/api/v1`

1. **Nur additive Änderungen:** neue Endpunkte, neue **optionale** Request-Felder, neue Response-Felder, neue Enum-Werte.
2. **Nie** innerhalb v1: Felder entfernen oder umbenennen, Typen ändern, optionale Request-Felder zu Pflichtfeldern machen, Fehlercodes umdeuten, Pfade ändern.
3. **Enums sind offen.** Generierte Swift-Enums haben `unknown(String)`. Die App zeigt unbekannte Status mit ihrem Rohwert an und bietet dafür keine Aktion an. Neue Werte erst serverseitig einführen, wenn das für alte Apps tragbar ist (z. B. neuer Task-Status: alte Apps zeigen ihn als eigene Spalte).
4. **Nullable bleibt nullable.** Antworten enthalten Felder immer (Wert oder `null`). Unbekannte Felder ignoriert `JSONDecoder`.
5. **Brechende Änderung = `/api/v2`** neben v1. v1 bleibt bestehen, bis `MIN_IOS_BUILD` alle v1-Builds ausschließt.
6. **Notbremse:** `MIN_IOS_BUILD` (Vercel-Env) schickt älteren Builds `CLIENT_OUTDATED` (426). Die App zeigt dann „Update erforderlich“. Nur setzen, wenn ein Build im App Store verfügbar ist, der die Grenze erfüllt.

`packages/backend/tests/api.test.ts` prüft, dass `generated/openapi.json` aktuell ist. Die CI prüft per `npm run generate:check`, dass die Swift-Modelle zum Vertrag passen. Für Review: Ein Diff in `generated/openapi.json`, der Properties oder Enum-Werte **entfernt**, ist ein Blocker.

## Datenbankmigrationen

- Migrationen müssen mit der **aktuell laufenden** Web-Version und allen **unterstützten** iOS-Builds funktionieren: neue Spalten mit Default oder nullable; Umbenennungen in zwei Schritten (neu anlegen, doppelt schreiben, später alt entfernen).
- Nur `packages/database` erzeugt und führt Migrationen aus (`npm run db:migrate`). Die iOS-App tut das nie.
- Migrationen laufen **vor** dem Deployment des Codes, der sie braucht (README: kein automatischer Lauf im Build).

## Reihenfolge je Änderungsart

| Änderung | Reihenfolge |
| --- | --- |
| Neues Feld/Feature für beide | 1. Migration (additiv) → 2. Backend + Vertrag + Web deployen (Vercel) → 3. iOS-Build einreichen; die App nutzt das Feld erst nach Update. |
| Nur Web | Web deployen. Vertrag unverändert. |
| Nur iOS, ohne Backend | iOS-Build einreichen. |
| Nur iOS, neuer Endpunkt | 1. Backend/Vertrag additiv deployen → 2. iOS-Build einreichen. |
| Feld/Endpunkt entfernen | 1. Web und iOS hören auf, es zu nutzen → 2. iOS-Build mit Nutzung ausgeliefert, `MIN_IOS_BUILD` anheben, wenn alte Builds verschwinden sollen → 3. Backend entfernt es (ggf. in `/api/v2`) → 4. Migration entfernt die Spalte. |
| Fachregel verschärfen (z. B. neue Berechtigung) | Backend deployen; gilt sofort für beide. Alte Apps zeigen die Server-Fehlermeldung (`FORBIDDEN`/`VALIDATION`, deutsch). |

Backend, Web und iOS lassen sich unabhängig veröffentlichen, solange die Regeln oben eingehalten werden.
