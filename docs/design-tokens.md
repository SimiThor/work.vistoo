# Design-Tokens

Quelle: `packages/design-tokens/tokens.json`. `npm run generate` erzeugt daraus:

| Ziel | Datei | Inhalt |
| --- | --- | --- |
| Web | `apps/web/src/app/tokens.generated.css` | `:root`-Variablen (Farben, Schatten, `--radius`) und die Tailwind-Typo-Skala (`@theme inline`); eingebunden in `globals.css` |
| iOS | `apps/ios/Packages/VistooKit/Sources/VistooUI/Generated/DesignTokens.swift` | `Tokens.Palette`, `Tokens.Radius`, `Tokens.Spacing`, `Tokens.Shadow`, `Tokens.Typography` |

Die Web-Werte sind beim Umzug unverändert geblieben (gleiche Variablennamen und Werte wie vorher in `globals.css`).

## Gruppen

- **color:** neutrale Flächen, eine Akzentfarbe (Blau) für Interaktion, Statusfarben nur für Icons (Text bleibt neutral; Status ist zusätzlich an der Form erkennbar), Warn- und Fehlerfarben, Timeline-Balken.
- **radius / spacing:** 4-pt-Raster; im Web entspricht das der Tailwind-Skala.
- **shadow:** pro Plattform eigene Darstellung (CSS-String bzw. Opacity/Radius/Y).
- **typography:** semantische Rollen. Web nutzt die kompakte rem-Skala, iOS die Dynamic-Type-Stile (`title2`, `headline`, `body` …). So skaliert die Schrift mit der Systemeinstellung.

## Plattform-Overrides

`overrides.ios` bzw. `overrides.web` ändern einen Token **nur** auf dieser Plattform. Jeder Override braucht eine Begründung (`reason`), sie landet als Kommentar im generierten Code. Aktuell:

| Token | Basis (Web) | iOS | Grund |
| --- | --- | --- | --- |
| `color.surface-subtle` | `#f5f5f7` | `#f2f2f7` | entspricht dem iOS-Gruppen-Hintergrund, native Listen und eigene Flächen gehen ineinander über |
| `radius.lg` | 8 | 10 | Touch-Karten wirken auf dem iPhone mit etwas runderen Ecken stimmiger |

`node --test` in `packages/design-tokens` prüft, dass iOS-Overrides nicht ins Web gelangen und Marken- sowie Statusfarben auf beiden Plattformen identisch bleiben.

**Regel:** Für eine plattformspezifische Anpassung nie den Basiswert ändern, sondern einen Override eintragen. Eine Änderung am Basiswert ändert immer beide Plattformen.

## iOS-Umsetzung

Die App nutzt Systemschrift, SF Symbols, native Listen, Sheets und Materialien (`.bar`). Die Tokens sorgen für Wiedererkennbarkeit (Akzentblau, Statusfarben und -formen, ruhige graue Flächen, Projektfarben, Logo). Erscheinungsbild ist **hell**, wie im Web (das Web-MVP hat keinen Dark Mode). Ein dunkles Schema bräuchte zuerst eine Dark-Palette in den Tokens, für beide Plattformen.
