import { NextRequest, NextResponse } from "next/server";
import db, { now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

/** Follow / unfollow an event. Followed NFT-gated events make their
 *  holders blink with the event theme color on the follower's map. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);
  const event = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
  if (!event)
    return NextResponse.json({ error: "Event not found", code: "EVENT_NOT_FOUND" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "unfollow" ? "unfollow" : "follow";

  if (action === "follow") {
    db.prepare(
      "INSERT OR IGNORE INTO event_follows (user_id, event_id, created_at) VALUES (?,?,?)"
    ).run(user.id, eventId, now());
  } else {
    db.prepare("DELETE FROM event_follows WHERE user_id = ? AND event_id = ?").run(
      user.id,
      eventId
    );
  }

  const followers = (
    db
      .prepare("SELECT COUNT(*) AS n FROM event_follows WHERE event_id = ?")
      .get(eventId) as { n: number }
  ).n;

  return NextResponse.json({ ok: true, following: action === "follow", followers });
}
