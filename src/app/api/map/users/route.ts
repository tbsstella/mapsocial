import { NextResponse } from "next/server";
import db, { activeOrganizerIds } from "@/lib/db";
import { countryByCode } from "@/lib/countries";
import { getSessionUser } from "@/lib/session";

interface MapRow {
  id: number;
  address: string;
  account_type: string;
  trust_score: number;
  username: string;
  avatar: string;
  avatar_url: string | null;
  gender: string;
  gender_visibility: string;
  location_mode: "approx" | "country";
  lat: number | null;
  lng: number | null;
  country: string | null;
}

/** Deterministic jitter so country-level markers don't jump between fetches. */
function jitter(userId: number, salt: number): number {
  const x = Math.sin(userId * 7919 + salt * 104729) * 10000;
  return (x - Math.floor(x) - 0.5) * 4; // ±2 degrees
}

export async function GET() {
  const me = await getSessionUser();

  const rows = db
    .prepare(
      `SELECT u.id, u.address, u.account_type, u.trust_score,
              p.username, p.avatar, p.avatar_url, p.gender, p.gender_visibility,
              p.location_mode, p.lat, p.lng, p.country
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE p.profile_visibility = 'visible'`
    )
    .all() as MapRow[];

  const blockedByMe = new Set<number>(
    me
      ? (db.prepare("SELECT blocked_id FROM blocks WHERE blocker_id = ?").all(me.id) as {
          blocked_id: number;
        }[]).map((r) => r.blocked_id)
      : []
  );

  const organizers = activeOrganizerIds();

  const users = rows
    .filter((r) => !blockedByMe.has(r.id))
    .map((r) => {
      let lat = r.lat;
      let lng = r.lng;
      const approx = r.location_mode === "approx" && lat != null && lng != null;
      if (!approx) {
        const c = countryByCode(r.country);
        if (!c || c.code === "OTHER") return null;
        lat = c.lat + jitter(r.id, 1);
        lng = c.lng + jitter(r.id, 2);
      }
      return {
        address: r.address,
        username: r.username,
        avatar: r.avatar,
        avatarUrl: r.avatar_url,
        accountType: r.account_type,
        isOrganizer: organizers.has(r.id),
        gender: r.gender_visibility === "visible" ? r.gender : null,
        trustScore: r.trust_score,
        lat,
        lng,
        locationMode: approx ? "approx" : "country",
        country: r.country,
        isMe: me?.id === r.id,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ users });
}
