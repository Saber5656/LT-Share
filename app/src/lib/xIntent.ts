const X_INTENT_ENDPOINT = "https://x.com/intent/post";

// FR-08: the text is handed to X as a plain link. Opening it from a real anchor
// lets a phone pass it to the X app when one is installed (browser version otherwise).
export function buildXIntentUrl(text: string): string {
  return `${X_INTENT_ENDPOINT}?text=${encodeURIComponent(text)}`;
}
