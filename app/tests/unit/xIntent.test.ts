import { test } from "node:test";
import assert from "node:assert/strict";
import { buildXIntentUrl } from "../../src/lib/xIntent.ts";

test("buildXIntentUrl percent-encodes the whole composed text", () => {
  const text = "RustでCLIを作るLT。\n\n#TechLTNight #Rust\n\n開発者：";
  const url = buildXIntentUrl(text);

  assert.ok(url.startsWith("https://x.com/intent/post?text="));
  const encoded = url.slice("https://x.com/intent/post?text=".length);
  assert.equal(encoded, encodeURIComponent(text));
  assert.ok(encoded.includes("%23TechLTNight"), "# is encoded so it does not start a fragment");
  assert.ok(encoded.includes("%0A%0A"), "newlines are kept");
  assert.ok(encoded.includes(encodeURIComponent("開発者：")));
  assert.equal(new URL(url).searchParams.get("text"), text);
});

test("buildXIntentUrl encodes characters that would break the query string", () => {
  const text = "A&B=C?D+E 100%";
  assert.equal(new URL(buildXIntentUrl(text)).searchParams.get("text"), text);
});
