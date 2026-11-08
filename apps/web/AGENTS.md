# apps/web – Hinweise

Gilt zusätzlich zur zentralen [AGENTS.md](../../AGENTS.md).

- **Rolle:** Web-UI plus dünne Adapter. `src/app/actions/*` (Server Actions) und `src/app/api/v1/[...path]/route.ts` (native Clients) rufen dieselben Services aus `@vistoo/backend` auf. In `src/server` liegen nur Next-spezifische Teile: Cookie-Session (`auth.ts`), `runAction`, request-gecachte Loader.
- **Keine Fachregeln hier.** Neue Regeln kommen nach `packages/backend` (bzw. `packages/domain` für Validierung/Konstanten), sonst gelten sie nicht für iOS.
- **Imports:** Domain `@vistoo/domain[/validation|/chat-config|/chat-types|/dates|/result|/filters|/dto|/links|/todos|/ideas|/crm]`, Services `@vistoo/backend/services/*`, Schema `@vistoo/database/schema`. `@/…` nur für Web-interne Module.
- **Design:** Farben, Schatten, Radius und Typo-Skala kommen aus `src/app/tokens.generated.css`. Änderungen in `packages/design-tokens/tokens.json` (Web-only: `overrides.web`), danach `npm run generate`.
- **Env:** `apps/web/.env.local` (Vorlage `.env.example`). Vercel: Root Directory `apps/web`.
- **Nur-Web-Änderungen** brauchen keine iOS-Anpassung. Ändert sich ein Service-Ergebnis, nur additiv (siehe `docs/architecture/releases.md`).
- **Tests:** E2E unter `tests/e2e`. `cross-platform.spec.ts` sichert das Zusammenspiel mit dem iOS-Protokoll ab.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
