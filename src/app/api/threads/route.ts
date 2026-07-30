import { NextRequest, NextResponse } from "next/server";
import db, { getUserByAddress, getProfile, isActiveOrganizer, isBlocked, now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getQuota } from "@/lib/quota";
import { maybeBotReply } from "@/lib/botreply";

export async function GET() {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });

  const rows = db
    .prepare(
      `SELECT t.id, t.initiator_id, t.last_message_at,
              CASE WHEN t.user_a = ? THEN t.user_b ELSE t.user_a END AS other_id
       FROM threads t
       WHERE t.user_a = ? OR t.user_b = ?
       ORDER BY t.last_message_at DESC`
    )
    .all(me.id, me.id, me.id) as {
    id: number;
    initiator_id: number;
    last_message_at: number;
    other_id: number;
  }[];

  const threads = rows.map((t) => {
    const other = db
      .prepare(
        `SELECT u.address, u.account_type, p.username, p.avatar, p.avatar_url,
                p.gender, p.gender_visibility
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`
      )
      .get(t.other_id) as {
      address: string;
      account_type: string;
      username: string | null;
      avatar: string | null;
      avatar_url: string | null;
      gender: string | null;
      gender_visibility: string | null;
    };
    const last = db
      .prepare(
        "SELECT body, sender_id, created_at FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(t.id) as { body: string; sender_id: number; created_at: number } | undefined;
    return {
      id: t.id,
      other: {
        address: other.address,
        username: other.username,
        avatar: other.avatar ?? "default",
        avatarUrl: other.avatar_url,
        accountType: other.account_type,
        isOrganizer: isActiveOrganizer(t.other_id),
        gender: other.gender_visibility === "visible" ? other.gender : null,
      },
      lastMessage: last
        ? { body: last.body.slice(0, 80), fromMe: last.sender_id === me.id, at: last.created_at }
        : null,
      lastMessageAt: t.last_message_at,
    };
  });

  return NextResponse.json({ threads });
}

export async function POST(req: NextRequest) {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });
  if (me.account_type === "bot")
    return NextResponse.json(
      { error: "机器人账号不允许主动私信", code: "BOT_NO_INIT" },
      { status: 403 }
    );

  const b = (await req.json()) as { toAddress?: string; body?: string };
  const text = String(b.body ?? "").trim().slice(0, 2000);
  if (!b.toAddress || !text)
    return NextResponse.json(
      { error: "缺少收件人或内容", code: "MISSING_FIELDS" },
      { status: 400 }
    );

  const target = getUserByAddress(b.toAddress);
  const targetProfile = target ? getProfile(target.id) : undefined;
  if (!target || !targetProfile)
    return NextResponse.json({ error: "用户不存在", code: "USER_NOT_FOUND" }, { status: 404 });
  if (target.id === me.id)
    return NextResponse.json({ error: "不能给自己发私信", code: "SELF_ACTION" }, { status: 400 });
  if (targetProfile.messaging_allowed !== 1)
    return NextResponse.json({ error: "对方未开放私信", code: "DM_CLOSED" }, { status: 403 });
  if (isBlocked(me.id, target.id) || isBlocked(target.id, me.id))
    return NextResponse.json({ error: "无法向该用户发送私信", code: "BLOCKED" }, { status: 403 });

  const [a, bId] = me.id < target.id ? [me.id, target.id] : [target.id, me.id];
  const existing = db
    .prepare("SELECT id FROM threads WHERE user_a = ? AND user_b = ?")
    .get(a, bId) as { id: number } | undefined;
  if (existing)
    return NextResponse.json(
      { error: "会话已存在", code: "THREAD_EXISTS", threadId: existing.id },
      { status: 409 }
    );

  const quota = getQuota(me.id, me.trust_score);
  if (quota.remaining <= 0)
    return NextResponse.json(
      {
        error: "今日主动私信名额已用完。提高可信度或邀请好友可增加名额，名额每日重置。",
        code: "QUOTA_EXCEEDED",
      },
      { status: 429 }
    );

  const t = now();
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        "INSERT INTO threads (user_a, user_b, initiator_id, created_at, last_message_at) VALUES (?,?,?,?,?)"
      )
      .run(a, bId, me.id, t, t);
    const threadId = Number(res.lastInsertRowid);
    db.prepare(
      "INSERT INTO messages (thread_id, sender_id, body, created_at) VALUES (?,?,?,?)"
    ).run(threadId, me.id, text, t);
    return threadId;
  });

  const threadId = tx();

  // Bot target with a connected AI model → async auto-reply (clients poll).
  if (target.account_type === "bot") {
    void maybeBotReply(threadId, target.id).catch(() => {});
  }

  return NextResponse.json({ ok: true, threadId });
}
