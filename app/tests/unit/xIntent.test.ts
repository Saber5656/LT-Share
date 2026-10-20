import { test } from "node:test";
import assert from "node:assert/strict";
import { buildXIntentUrl, buildXAppUrl, detectMobilePlatform, replaceLoneSurrogates } from "../../src/lib/xIntent.ts";

test("iPhone/iPad links address the app composer without a web login page", () => {
  const text = "日本語 & #LT\n開発者：@example";
  const url = buildXAppUrl(text, "ios");
  assert.equal(url, `twitter://post?message=${encodeURIComponent(text)}`);
  assert.equal(new URL(url!).searchParams.get("message"), text);
});

test("Android intent pins X and keeps the full web fallback encoded", () => {
  const text = "a#Intent;scheme=evil;&日本語\n#LT";
  const url = buildXAppUrl(text, "android")!;
  assert.ok(url.startsWith("intent://post?message=" + encodeURIComponent(text)));
  assert.ok(url.endsWith("#Intent;scheme=twitter;package=com.twitter.android;S.browser_fallback_url=" + encodeURIComponent(buildXIntentUrl(text)) + ";end"));
  assert.equal(url.split("#Intent;").length, 2, "post text cannot inject an intent directive");
});

test("desktop keeps the web composer; malformed text is safe in app links too", () => {
  assert.equal(buildXAppUrl("hi", "web"), null);
  assert.doesNotThrow(() => buildXAppUrl("a\ud83db", "ios"));
  assert.equal(new URL(buildXAppUrl("a\ud83db", "ios")!).searchParams.get("message"), "a�b");
});

test("mobile detection includes iPad desktop mode without treating every Mac as iOS", () => {
  assert.equal(detectMobilePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), "ios");
  assert.equal(detectMobilePlatform({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/130" }), "android");
  assert.equal(detectMobilePlatform({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), "ios");
  assert.equal(detectMobilePlatform({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), "web");
  assert.equal(detectMobilePlatform({ userAgent: "unknown" }), "web");
});

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
