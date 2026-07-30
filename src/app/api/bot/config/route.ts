import { NextRequest, NextResponse } from "next/server";
import db, { getBotConfig, now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

/**
 * Bot operator settings (bot accounts only): plug your own conversational
 * bot into the chat window via an OpenAI-compatible endpoint. This is just
 * the opening — pricing/business logic live entirely on the operator's side;
 * operators can also skip this and drive replies via the open API/SDK.
 * The API key is write-only and never returned.
 */

function serialize(cfg: ReturnType<typeof getBotConfig>) {
  return {
    apiUrl: cfg?.api_url ?? "",
    hasApiKey: !!cfg?.api_key,
    model: cfg?.model ?? "",
    systemPrompt: cfg?.system_prompt ?? "",
    enabled: cfg?.enabled === 1,
  };
}

export async function GET() {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });
  if (me.account_type !== "bot")
    return NextResponse.json({ error: "Bot accounts only", code: "BOT_ONLY" }, { status: 403 });
  return NextResponse.json(serialize(getBotConfig(me.id)));
}

export async function PUT(req: NextRequest) {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });
  if (me.account_type !== "bot")
    return NextResponse.json({ error: "Bot accounts only", code: "BOT_ONLY" }, { status: 403 });

  const b = (await req.json()) as Record<string, unknown>;
  const bad = (msg: string) =>
    NextResponse.json({ error: msg, code: "BOT_CONFIG_INVALID" }, { status: 400 });

  const apiUrl = String(b.apiUrl ?? "").trim().slice(0, 300);
  if (apiUrl) {
    try {
      const u = new URL(apiUrl);
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1")
        return bad("API URL must be https (localhost excepted)");
    } catch {
      return bad("Invalid API URL");
    }
  }

  const model = String(b.model ?? "").trim().slice(0, 100);
  const systemPrompt = String(b.systemPrompt ?? "").slice(0, 2000);

  const enabled = b.enabled === true;
  if (enabled && (!apiUrl || !model))
    return bad("Auto-reply requires an API URL and a model");

  // Write-only API key: empty string keeps the stored one.
  const existing = getBotConfig(me.id);
  const apiKey = String(b.apiKey ?? "").trim().slice(0, 300) || existing?.api_key || "";

  db.prepare(
    `INSERT INTO bot_configs (user_id, api_url, api_key, model, system_prompt, enabled, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       api_url=excluded.api_url, api_key=excluded.api_key, model=excluded.model,
       system_prompt=excluded.system_prompt, enabled=excluded.enabled,
       updated_at=excluded.updated_at`
  ).run(me.id, apiUrl, apiKey, model, systemPrompt, enabled ? 1 : 0, now());

  return NextResponse.json(serialize(getBotConfig(me.id)));
}
