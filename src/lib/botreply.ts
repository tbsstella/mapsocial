import db, { getBotConfig, now } from "./db";
import { checkLicense, TIER_BOT } from "./license";

/**
 * Bot auto-reply: when a human messages a bot account whose operator has
 * connected an OpenAI-compatible endpoint, the last few messages are sent to
 * the model and the completion is inserted as the bot's reply.
 *
 * Fire-and-forget by design: chat clients poll every 5s, so the reply shows
 * up like a typing delay. Failures are swallowed (the human can re-read the
 * thread; the reply gate opens only when a reply actually lands).
 */

const CONTEXT_MESSAGES = 12;
const MAX_REPLY_CHARS = 2000;

interface MsgRow {
  sender_id: number;
  body: string;
  kind: string;
}

export async function maybeBotReply(threadId: number, botUserId: number): Promise<void> {
  const cfg = getBotConfig(botUserId);
  if (!cfg || !cfg.enabled || !cfg.api_url || !cfg.model) return;

  // Operator license must still be active (dev fallback applies).
  const bot = db.prepare("SELECT address FROM users WHERE id = ?").get(botUserId) as
    | { address: string }
    | undefined;
  if (!bot) return;
  const license = await checkLicense(bot.address, TIER_BOT);
  if (!license.ok) return;

  const rows = db
    .prepare(
      `SELECT sender_id, body, kind FROM messages
       WHERE thread_id = ? AND kind = 'text'
       ORDER BY id DESC LIMIT ?`
    )
    .all(threadId, CONTEXT_MESSAGES) as MsgRow[];
  const history = rows.reverse().map((m) => ({
    role: m.sender_id === botUserId ? "assistant" : "user",
    content: m.body,
  }));
  if (history.length === 0 || history[history.length - 1].role !== "user") return;

  const messages = [
    {
      role: "system",
      content:
        cfg.system_prompt ||
        "You are a helpful chat companion on MapSocial. Reply briefly in the user's language.",
    },
    ...history,
  ];

  let reply: string | null = null;
  try {
    const res = await fetch(`${cfg.api_url.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: 400 }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    reply = data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return;
  }
  if (!reply) return;

  const t = now();
  db.prepare(
    "INSERT INTO messages (thread_id, sender_id, body, created_at) VALUES (?,?,?,?)"
  ).run(threadId, botUserId, reply.slice(0, MAX_REPLY_CHARS), t);
  db.prepare("UPDATE threads SET last_message_at = ? WHERE id = ?").run(t, threadId);
}
