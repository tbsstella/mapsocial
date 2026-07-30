/**
 * Image compliance hook for avatar uploads.
 *
 * When OPENAI_API_KEY is set, images are screened with the OpenAI moderation
 * API (omni-moderation handles images) and rejected when flagged. Without a
 * key the check passes — acceptable for local development only; production
 * deployments MUST configure a moderation provider (this hook is the single
 * integration point to swap in Google Vision SafeSearch, AWS Rekognition,
 * a vendor of choice, or a manual review queue).
 */

const MODERATION_URL =
  process.env.MODERATION_API_URL ?? "https://api.openai.com/v1/moderations";

export interface ModerationResult {
  ok: boolean;
  /** True when no provider is configured and the image was not screened. */
  skipped: boolean;
}

export async function checkImage(
  bytes: Buffer,
  mimeType: string
): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: true, skipped: true };

  try {
    const res = await fetch(MODERATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${bytes.toString("base64")}` },
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, skipped: false }; // fail closed when screening errors
    const data = (await res.json()) as { results?: { flagged: boolean }[] };
    const flagged = data.results?.some((r) => r.flagged) ?? true;
    return { ok: !flagged, skipped: false };
  } catch {
    return { ok: false, skipped: false }; // fail closed
  }
}
