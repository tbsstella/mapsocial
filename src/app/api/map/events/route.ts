import { NextResponse } from "next/server";
import db, { now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { filterHolders, type NftGate } from "@/lib/nftgate";

interface EventRow {
  id: number;
  title: string;
  lat: number;
  lng: number;
  starts_at: number;
  ends_at: number;
  theme_color: string;
  nft_chain: string | null;
  nft_standard: string | null;
  nft_contract: string | null;
  nft_token_id: string | null;
  venue_address: string | null;
}

/**
 * Map overlay data: live/upcoming events plus, for each live NFT-gated
 * event, the map-visible users currently holding the gate NFT (these get
 * the themed glow on the map).
 */
export async function GET() {
  const t = now();
  const viewer = await getSessionUser();

  const events = db
    .prepare(
      `SELECT id, title, lat, lng, starts_at, ends_at, theme_color,
              nft_chain, nft_standard, nft_contract, nft_token_id, venue_address
       FROM events WHERE ends_at > ? ORDER BY starts_at ASC LIMIT 50`
    )
    .all(t) as EventRow[];

  // Which of these the viewer follows (drives the blinking-holder effect).
  const followedIds = new Set<number>(
    viewer
      ? (
          db
            .prepare("SELECT event_id FROM event_follows WHERE user_id = ?")
            .all(viewer.id) as { event_id: number }[]
        ).map((r) => r.event_id)
      : []
  );
  const followerCounts = new Map<number, number>(
    (
      db
        .prepare(
          "SELECT event_id, COUNT(*) AS n FROM event_follows GROUP BY event_id"
        )
        .all() as { event_id: number; n: number }[]
    ).map((r) => [r.event_id, r.n])
  );

  const visibleAddresses = (
    db
      .prepare(
        `SELECT u.address FROM users u JOIN profiles p ON p.user_id = u.id
         WHERE p.profile_visibility = 'visible'`
      )
      .all() as { address: string }[]
  ).map((r) => r.address);

  const results = await Promise.all(
    events.map(async (e) => {
      const live = e.starts_at <= t && e.ends_at > t;
      let holders: string[] = [];
      if (live && e.nft_contract && e.nft_chain && e.nft_standard) {
        const gate: NftGate = {
          chainKey: e.nft_chain,
          standard: e.nft_standard as NftGate["standard"],
          contract: e.nft_contract as `0x${string}`,
          tokenId: e.nft_token_id,
        };
        holders = await filterHolders(`event:${e.id}`, gate, visibleAddresses);
      }
      return {
        id: e.id,
        title: e.title,
        lat: e.lat,
        lng: e.lng,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        themeColor: e.theme_color,
        live,
        gated: !!e.nft_contract,
        holders,
        venue: e.venue_address,
        followedByMe: followedIds.has(e.id),
        followers: followerCounts.get(e.id) ?? 0,
      };
    })
  );

  return NextResponse.json({ events: results });
}
