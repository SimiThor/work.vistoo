// Design tokens → platform files. No dependencies.
//   tokens.json (+ overrides.web)  → apps/web/src/app/tokens.generated.css
//   tokens.json (+ overrides.ios)  → apps/ios/Packages/VistooKit/Sources/VistooUI/Generated/DesignTokens.swift
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../../..");
const tokens = JSON.parse(readFileSync(path.join(here, "../tokens.json"), "utf8"));

const entries = (obj) => Object.entries(obj).filter(([k]) => !k.startsWith("$"));

/** Base values merged with the overrides of one platform. */
export function resolve(platform) {
  const o = tokens.overrides?.[platform] ?? {};
  const merge = (group) =>
    Object.fromEntries(entries(tokens[group]).map(([k, t]) => [k, o[group]?.[k]?.value ?? t.value]));
  return { color: merge("color"), radius: merge("radius"), spacing: merge("spacing") };
}

export function css() {
  const t = resolve("web");
  const lines = [
    "/* Generated from packages/design-tokens/tokens.json (npm run generate). Do not edit by hand. */",
    ":root {",
    ...entries(t.color)
      .filter(([k]) => !k.startsWith("timeline-"))
      .map(([k, v]) => `  --${k}: ${v};`),
    ...entries(t.color)
      .filter(([k]) => k.startsWith("timeline-"))
      .map(([k, v]) => `  --${k}: ${v};`),
    ...entries(tokens.shadow).map(([k, s]) => `  --shadow-${k}: ${s.web};`),
    `  --radius: ${t.radius.base / 16}rem; /* ${t.radius.base}px; derived sm/md/lg/xl in globals.css */`,
    "}",
    "",
    "@theme inline {",
    ...entries(tokens.typography).flatMap(([, ty]) => [
      `  --text-${ty.web.tailwind}: ${ty.web.size};`,
      `  --text-${ty.web.tailwind}--line-height: ${ty.web.lineHeight};`,
    ]),
    "}",
    "",
  ];
  return lines.join("\n");
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export function swift() {
  const t = resolve("ios");
  const hex = (v) => `0x${v.slice(1).toUpperCase()}`;
  const doc = (group, k) => {
    const o = tokens.overrides?.ios?.[group]?.[k];
    const d = tokens[group][k]?.description;
    return o ? `    /// iOS override: ${o.reason}` : d ? `    /// ${d}` : null;
  };
  const lines = [
    "// Generated from packages/design-tokens/tokens.json (npm run generate). Do not edit by hand.",
    "// swiftlint:disable all",
    "import SwiftUI",
    "",
    "/// Vistoo design tokens for iOS (base values + explicit iOS overrides).",
    "public enum Tokens {",
    "  public enum Palette {",
    ...entries(t.color).flatMap(([k, v]) =>
      [doc("color", k), `    public static let ${camel(k)} = Color(hex: ${hex(v)})`].filter(Boolean).map((l) => l.replace(/^ {4}/, "    ")),
    ),
    "  }",
    "",
    "  public enum Radius {",
    ...entries(t.radius).flatMap(([k, v]) => [doc("radius", k), `    public static let ${k}: CGFloat = ${v}`].filter(Boolean)),
    "  }",
    "",
    "  public enum Spacing {",
    ...entries(t.spacing).map(([k, v]) => `    public static let ${k}: CGFloat = ${v}`),
    "  }",
    "",
    "  public struct Shadow: Sendable {",
    "    public let opacity: Double",
    "    public let radius: CGFloat",
    "    public let y: CGFloat",
    ...entries(tokens.shadow).map(
      ([k, s]) => `    public static let ${camel(k)} = Shadow(opacity: ${s.ios.opacity}, radius: ${s.ios.radius}, y: ${s.ios.y})`,
    ),
    "  }",
    "",
    "  /// Semantic text roles mapped to Dynamic Type styles.",
    "  public enum Typography {",
    ...entries(tokens.typography).map(
      ([k, ty]) => `    public static let ${camel(k)}: Font = .system(.${ty.ios.style}, weight: .${ty.ios.weight})`,
    ),
    "  }",
    "}",
    "",
  ];
  return lines.join("\n");
}

function write(rel, content) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`✓ ${rel}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, "generate.mjs")) {
  write("apps/web/src/app/tokens.generated.css", css());
  write("apps/ios/Packages/VistooKit/Sources/VistooUI/Generated/DesignTokens.swift", swift());
}
