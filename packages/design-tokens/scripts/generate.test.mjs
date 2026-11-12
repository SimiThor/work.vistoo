import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { css, kotlin, resolve, swift } from "./generate.mjs";

test("iOS overrides never leak into the web output", () => {
  const web = resolve("web");
  const ios = resolve("ios");
  assert.equal(web.color["surface-subtle"], "#f5f5f7");
  assert.equal(ios.color["surface-subtle"], "#f2f2f7");
  assert.match(css(), /--surface-subtle: #f5f5f7;/);
  assert.equal(web.radius.lg, 8);
  assert.equal(ios.radius.lg, 10);
});

test("shared brand and status colours are identical on both platforms", () => {
  const web = resolve("web");
  const ios = resolve("ios");
  for (const key of ["accent-blue", "status-open", "status-progress", "status-review", "status-done", "destructive"]) {
    assert.equal(web.color[key], ios.color[key], key);
  }
});

test("every colour token is emitted for both platforms", () => {
  const out = swift();
  for (const key of Object.keys(resolve("web").color)) {
    assert.match(css(), new RegExp(`--${key}:`));
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    assert.match(out, new RegExp(`static let ${camel} = Color\\((hex|light):`));
  }
});

test("Android overrides stay out of web and iOS, every colour reaches Kotlin", () => {
  const android = resolve("android");
  assert.equal(resolve("web").color["surface-subtle"], "#f5f5f7");
  assert.equal(android.color["surface-subtle"], "#f2f2f7");
  assert.equal(android.color["accent-blue"], resolve("web").color["accent-blue"]);
  const out = kotlin();
  for (const key of Object.keys(resolve("web").color)) {
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    assert.match(out, new RegExp(`val ${camel}(: Color get\\(\\) = if \\(isDark\\) Color\\(0xFF| = Color\\(0xFF)`));
  }
});

test("every colour has a dark value; web emits it for the class and the system setting", () => {
  const { color } = JSON.parse(readFileSync(new URL("../tokens.json", import.meta.url), "utf8"));
  for (const [key, t] of Object.entries(color)) {
    if (key.startsWith("$")) continue;
    assert.match(t.dark ?? "", /^#[0-9a-f]{6}$/, `${key} has no dark value`);
  }
  const out = css();
  assert.match(out, /:root\.dark \{[^}]*--background: #1c1c1e;/);
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light\) \{[^}]*--background: #1c1c1e;/);
});

test("dark overrides apply per platform only", () => {
  assert.equal(resolve("ios").dark["surface-subtle"], "#000000");
  assert.equal(resolve("android").dark["surface-subtle"], "#000000");
  assert.equal(resolve("web").dark["surface-subtle"], "#121214");
  assert.match(swift(), /surfaceSubtle = Color\(light: 0xF2F2F7, dark: 0x000000\)/);
});
