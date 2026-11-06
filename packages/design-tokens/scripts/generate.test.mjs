import assert from "node:assert/strict";
import { test } from "node:test";
import { css, resolve, swift } from "./generate.mjs";

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
    assert.match(out, new RegExp(`static let ${camel} = Color`));
  }
});
