import { NextRequest, NextResponse } from "next/server";
import db, { getUserById, isActiveOrganizer, isBlocked, now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { checkLicense, TIER_BOT } from "@/lib/license";
import { maybeBotReply } from "@/lib/botreply";

interface ThreadRow {
  id: number;
  user_a: number;
  user_b: number;
  initiator_id: number;
}

function getThreadFor(threadId: number, userId: number): ThreadRow | null {
  const t = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as
    | ThreadRow
    | undefined;
  if (!t || (t.user_a !== userId && t.user_b !== userId)) return null;
  return t;
}

/** The initiator may only send one message until the counterpart replies.
 *  Tips are ignored on both sides: they neither consume the slot nor count
 *  as a reply. */
function replyGateBlocked(t: ThreadRow, meId: number): boolean {
  if (t.initiator_id !== meId) return false;
  const otherId = t.user_a === meId ? t.user_b : t.user_a;
  const otherReplied = db
    .prepare(
      "SELECT 1 FROM messages WHERE thread_id = ? AND sender_id = ? AND kind = 'text' LIMIT 1"
    )
    .get(t.id, otherId);
  if (otherReplied) return false;
  const myCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM messages WHERE thread_id = ? AND sender_id = ? AND kind = 'text'"
      )
      .get(t.id, meId) as { c: number }
  ).c;
  return myCount >= 1;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await params;
  const t = getThreadFor(Number(id), me.id);
  if (!t)
    return NextResponse.json({ error: "Conversation not found", code: "THREAD_NOT_FOUND" }, { status: 404 });

  const otherId = t.user_a === me.id ? t.user_b : t.user_a;
  const other = db
    .prepare(
      `SELECT u.address, u.account_type, u.trust_score, p.username, p.avatar, p.avatar_url,
              p.gender, p.gender_visibility
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`
    )
    .get(otherId) as {
    address: string;
    account_type: string;
    trust_score: number;
    username: string | null;
    avatar: string | null;
    avatar_url: string | null;
    gender: string | null;
    gender_visibility: string | null;
  };

  const messages = (
    db
      .prepare(
        `SELECT id, sender_id, body, created_at, kind, tip_amount, tip_tx
         FROM messages WHERE thread_id = ? ORDER BY id`
      )
      .all(t.id) as {
      id: number;
      sender_id: number;
      body: string;
      created_at: number;
      kind: string;
      tip_amount: string | null;
      tip_tx: string | null;
    }[]
  ).map((m) => ({
    id: m.id,
    fromMe: m.sender_id === me.id,
    body: m.body,
    at: m.created_at,
    kind: m.kind,
    tipAmount: m.tip_amount,
    tipTx: m.tip_tx,
  }));

  const blockedByMe = isBlocked(me.id, otherId);
  const blockedMe = isBlocked(otherId, me.id);

  return NextResponse.json({
    id: t.id,
    other: {
      address: other.address,
      username: other.username,
      avatar: other.avatar ?? "default",
      avatarUrl: other.avatar_url,
      accountType: other.account_type,
      isOrganizer: isActiveOrganizer(otherId),
      gender: other.gender_visibility === "visible" ? other.gender : null,
      trustScore: other.trust_score,
    },
    messages,
    blockedByMe,
    canSend: !blockedByMe && !blockedMe && !replyGateBlocked(t, me.id),
    awaitingReply: replyGateBlocked(t, me.id),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await params;
  const t = getThreadFor(Number(id), me.id);
  if (!t)
    return NextResponse.json({ error: "Conversation not found", code: "THREAD_NOT_FOUND" }, { status: 404 });

  const otherId = t.user_a === me.id ? t.user_b : t.user_a;
  if (isBlocked(me.id, otherId) || isBlocked(otherId, me.id))
    return NextResponse.json(
      { error: "You can't send messages in this conversation", code: "CANNOT_SEND" },
      { status: 403 }
    );

  if (replyGateBlocked(t, me.id))
    return NextResponse.json(
      { error: "They haven't replied yet. You can't send more until they respond", code: "REPLY_GATE" },
      { status: 429 }
    );

  // Bot operators must hold an active bot-tier stake (dev fallback applies
  // until the LicenseStake contract is configured).
  if (me.account_type === "bot") {
    const license = await checkLicense(me.address, TIER_BOT);
    if (!license.ok)
      return NextResponse.json(
        { error: "Bot needs an operator license (stake SIMN)", code: "BOT_LICENSE_REQUIRED" },
        { status: 403 }
      );
  }

  const b = (await req.json()) as { body?: string };
  const text = String(b.body ?? "").trim().slice(0, 2000);
  if (!text)
    return NextResponse.json({ error: "Message is empty", code: "EMPTY_BODY" }, { status: 400 });

  const tNow = now();
  db.prepare(
    "INSERT INTO messages (thread_id, sender_id, body, created_at) VALUES (?,?,?,?)"
  ).run(t.id, me.id, text, tNow);
  db.prepare("UPDATE threads SET last_message_at = ? WHERE id = ?").run(tNow, t.id);

  // Bot recipient with a connected AI model → async auto-reply (clients poll).
  const other = getUserById(otherId);
  if (other?.account_type === "bot" && me.account_type === "human") {
    void maybeBotReply(t.id, other.id).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
