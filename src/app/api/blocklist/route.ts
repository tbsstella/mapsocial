import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const rows = db
    .prepare(
      `SELECT u.address, p.username, p.avatar, b.created_at
       FROM blocks b
       JOIN users u ON u.id = b.blocked_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(me.id);

  return NextResponse.json({ blocked: rows });
}
