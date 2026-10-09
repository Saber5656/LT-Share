const X_INTENT_ENDPOINT = "https://x.com/intent/post";

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

// FR-08: the text is handed to X as a plain link. Opening it from a real anchor
// lets a phone pass it to the X app when one is installed (browser version otherwise).
export function buildXIntentUrl(text: string): string {
  return `${X_INTENT_ENDPOINT}?text=${encodeURIComponent(toWellFormed(text))}`;
}
