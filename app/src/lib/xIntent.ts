const X_INTENT_ENDPOINT = "https://x.com/intent/post";

export type MobilePlatform = "ios" | "android" | "web";
export function detectMobilePlatform(env: { userAgent: string; platform?: string; maxTouchPoints?: number }): MobilePlatform {
  if (/Android/i.test(env.userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(env.userAgent) || (env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1)) return "ios";
  return "web";
}
// App link support is controlled by X and the OS: these links request a launch,
// not a success receipt. Keep a visible web/copy alternative in the UI.
export function buildXAppUrl(text: string, platform: MobilePlatform): string | null {
  const message = encodeURIComponent(toWellFormed(text));
  if (platform === "ios") return `twitter://post?message=${message}`;
  if (platform === "android") {
    return `intent://post?message=${message}#Intent;scheme=twitter;package=com.twitter.android;S.browser_fallback_url=${encodeURIComponent(buildXIntentUrl(text))};end`;
  }
  return null;
}

// encodeURIComponent throws a URIError on an unpaired surrogate (for example an
// emoji split by editing). Replace each one with U+FFFD instead of failing.
export function replaceLoneSurrogates(text: string): string {
  // Scanned by hand instead of with a lookbehind regex, which older iOS Safari rejects at parse time.
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const isHigh = unit >= 0xd800 && unit <= 0xdbff;
    const isLow = unit >= 0xdc00 && unit <= 0xdfff;
    if (isHigh) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i++;
      } else {
        out += "�";
      }
    } else {
      out += isLow ? "�" : text[i]!;
    }
  }
  return out;
}

function toWellFormed(text: string): string {
  const native = (text as { toWellFormed?: () => string }).toWellFormed;
  return typeof native === "function" ? native.call(text) : replaceLoneSurrogates(text);
}

// Web fallback: an HTTPS intent may stay in a signed-out browser even when the
// native app is installed. Do not rely on it as an app-launch guarantee.
export function buildXIntentUrl(text: string): string {
  return `${X_INTENT_ENDPOINT}?text=${encodeURIComponent(toWellFormed(text))}`;
}
