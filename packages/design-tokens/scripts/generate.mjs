// Design tokens → platform files. No dependencies.
//   tokens.json (+ overrides.web)  → apps/web/src/app/tokens.generated.css
//   tokens.json (+ overrides.ios)  → apps/ios/Packages/VistooKit/Sources/VistooUI/Generated/DesignTokens.swift
//   tokens.json (+ overrides.android) → apps/android/app/src/main/java/de/vistoo/work/ui/generated/DesignTokens.kt
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
  // Dark appearance: override's dark value, else the base dark value, else the light value.
  const dark = Object.fromEntries(
    entries(tokens.color).map(([k, t]) => [k, o.color?.[k]?.dark ?? t.dark ?? o.color?.[k]?.value ?? t.value]),
  );
  return { color: merge("color"), dark, radius: merge("radius"), spacing: merge("spacing") };
}

export function css() {
  const t = resolve("web");
  const ordered = (palette) => [
    ...entries(palette).filter(([k]) => !k.startsWith("timeline-")),
    ...entries(palette).filter(([k]) => k.startsWith("timeline-")),
  ];
  const darkVars = (indent) => [
    ...ordered(t.dark).map(([k, v]) => `${indent}--${k}: ${v};`),
    ...entries(tokens.shadow).map(([k, s]) => `${indent}--shadow-${k}: ${s.webDark ?? s.web};`),
    `${indent}color-scheme: dark;`,
  ];
  const lines = [
    "/* Generated from packages/design-tokens/tokens.json (npm run generate). Do not edit by hand. */",
    "/* Light: default. Dark: class `dark` on <html> (user choice or system, set before paint),",
    "   or the system setting when no class was set (e.g. without JavaScript). Class `light` forces light. */",
    ":root {",
    ...ordered(t.color).map(([k, v]) => `  --${k}: ${v};`),
    ...entries(tokens.shadow).map(([k, s]) => `  --shadow-${k}: ${s.web};`),
    `  --radius: ${t.radius.base / 16}rem; /* ${t.radius.base}px; derived sm/md/lg/xl in globals.css */`,
    "  color-scheme: light;",
    "}",
    "",
    ":root.dark {",
    ...darkVars("  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root:not(.light) {",
    ...darkVars("    "),
    "  }",
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
  const color = (k, v) =>
    t.dark[k] === v ? `Color(hex: ${hex(v)})` : `Color(light: ${hex(v)}, dark: ${hex(t.dark[k])})`;
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
    "/// Colours adapt to the system appearance (light/dark).",
    "public enum Tokens {",
    "  public enum Palette {",
    ...entries(t.color).flatMap(([k, v]) =>
      [doc("color", k), `    public static let ${camel(k)} = ${color(k, v)}`].filter(Boolean).map((l) => l.replace(/^ {4}/, "    ")),
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


export function kotlin() {
  const t = resolve("android");
  const hex = (v) => `0xFF${v.slice(1).toUpperCase()}`;
  const color = (k, v) =>
    t.dark[k] === v ? `    val ${camel(k)} = Color(${hex(v)})` : `    val ${camel(k)}: Color get() = if (isDark) Color(${hex(t.dark[k])}) else Color(${hex(v)})`;
  const doc = (group, k) => {
    const o = tokens.overrides?.android?.[group]?.[k];
    const d = tokens[group][k]?.description;
    return o ? `    /** Android override: ${o.reason} */` : d ? `    /** ${d} */` : null;
  };
  const weight = { regular: "Normal", medium: "Medium", semibold: "SemiBold", bold: "Bold" };
  const lines = [
    "// Generated from packages/design-tokens/tokens.json (npm run generate). Do not edit by hand.",
    '@file:Suppress("unused", "ktlint")',
    "",
    "package de.vistoo.work.ui.generated",
    "",
    "import androidx.compose.runtime.getValue",
    "import androidx.compose.runtime.mutableStateOf",
    "import androidx.compose.runtime.setValue",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.text.TextStyle",
    "import androidx.compose.ui.text.font.FontWeight",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.sp",
    "",
    "/** Vistoo design tokens for Android (base values + explicit Android overrides). */",
    "object Tokens {",
    "  /**",
    "   * Dark appearance active. Set by VistooTheme from the system setting. Snapshot state:",
    "   * composables and draw blocks that read a palette colour update when it changes.",
    "   */",
    "  var isDark by mutableStateOf(false)",
    "",
    "  object Palette {",
    ...entries(t.color).flatMap(([k, v]) => [doc("color", k), color(k, v)].filter(Boolean)),
    "  }",
    "",
    "  object Radius {",
    ...entries(t.radius).flatMap(([k, v]) => [doc("radius", k), `    val ${k} = ${v}.dp`].filter(Boolean)),
    "  }",
    "",
    "  object Spacing {",
    ...entries(t.spacing).map(([k, v]) => `    val ${k} = ${v}.dp`),
    "  }",
    "",
    "  /** Same shadow parameters as iOS (opacity, blur radius, y offset in dp). */",
    "  data class Shadow(val opacity: Float, val radius: Float, val y: Float) {",
    "    companion object {",
    ...entries(tokens.shadow).map(
      ([k, s]) => `      val ${camel(k)} = Shadow(opacity = ${s.ios.opacity}f, radius = ${s.ios.radius}f, y = ${s.ios.y}f)`,
    ),
    "    }",
    "  }",
    "",
    "  /** Semantic text roles (sp: they scale with the system font size). */",
    "  object Typography {",
    ...entries(tokens.typography).map(
      ([k, ty]) =>
        `    val ${camel(k)} = TextStyle(fontSize = ${ty.android.size}.sp, lineHeight = ${ty.android.lineHeight}.sp, fontWeight = FontWeight.${weight[ty.android.weight]})`,
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
  write("apps/android/app/src/main/java/de/vistoo/work/ui/generated/DesignTokens.kt", kotlin());
}
