import { test } from "node:test";
import assert from "node:assert/strict";
import { buildXIntentUrl, replaceLoneSurrogates } from "../../src/lib/xIntent.ts";

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

test("buildXIntentUrl does not throw on lone surrogates and keeps valid emoji", () => {
  // encodeURIComponent throws URIError for a lone surrogate (e.g. a split emoji).
  const lonelyHigh = "a\ud83db";
  const lonelyLow = "a\ude00b";
  assert.doesNotThrow(() => buildXIntentUrl(lonelyHigh));
  assert.doesNotThrow(() => buildXIntentUrl(lonelyLow));
  assert.equal(new URL(buildXIntentUrl(lonelyHigh)).searchParams.get("text"), "a�b");
  assert.equal(new URL(buildXIntentUrl(lonelyLow)).searchParams.get("text"), "a�b");
  assert.equal(new URL(buildXIntentUrl("楽しい😀LT")).searchParams.get("text"), "楽しい😀LT");
});

test("replaceLoneSurrogates (fallback for engines without toWellFormed) only touches unpaired code units", () => {
  assert.equal(replaceLoneSurrogates("a\ud83db"), "a�b");
  assert.equal(replaceLoneSurrogates("a\ude00b"), "a�b");
  assert.equal(replaceLoneSurrogates("\ud83d"), "�");
  assert.equal(replaceLoneSurrogates("x😀y"), "x😀y");
  assert.equal(replaceLoneSurrogates("\ude00\ud83d"), "��");
});
