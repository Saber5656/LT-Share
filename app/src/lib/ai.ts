// AI post-text generation is NOT available in this version: the hosting
// platform cannot use the visitor's own ChatGPT plan yet (decision pending, see
// docs/requirements.md G-01). The rest of the app only talks to this interface,
// so a provider can be plugged in later by returning it from getAiProvider().
// While getAiProvider() returns null the UI shows no AI controls or labels.

export type AiInput = {
  image: Blob;
  tags: string[];
};

export type AiProvider = {
  generate(input: AiInput): Promise<string>;
};

/** Throw this from a provider when the user's usage limit is reached (NFR-03). */
export class AiQuotaError extends Error {
  constructor(message = "AI usage limit reached") {
    super(message);
    this.name = "AiQuotaError";
  }
}

export function getAiProvider(): AiProvider | null {
  return null;
}
