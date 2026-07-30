import { NextRequest, NextResponse } from "next/server";
import db, { getUserByAddress, now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { address } = await params;
  const target = getUserByAddress(address);
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (target.id === me.id)
    return NextResponse.json({ error: "不能拉黑自己" }, { status: 400 });

  const { action } = (await req.json()) as { action?: string };

  if (action === "unblock") {
    db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(
      me.id,
      target.id
    );
    return NextResponse.json({ ok: true, blocked: false });
  }

  db.prepare(
    "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)"
  ).run(me.id, target.id, now());

  // Being blocked lowers the blocked party's trust (applied at next refresh);
  // apply an immediate cheap decrement too so the effect is visible.
  db.prepare("UPDATE users SET trust_score = MAX(0, trust_score - 4) WHERE id = ?").run(
    target.id
  );

  return NextResponse.json({ ok: true, blocked: true });
}
