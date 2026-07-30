import { NextRequest, NextResponse } from "next/server";
import { getUserByAddress, getProfile, isBlocked, isActiveOrganizer } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { countryByCode } from "@/lib/countries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const me = await getSessionUser();

  const target = getUserByAddress(address);
  const profile = target ? getProfile(target.id) : undefined;
  if (!target || !profile) {
    return NextResponse.json({ error: "User not found", code: "USER_NOT_FOUND" }, { status: 404 });
  }

  const isMe = me?.id === target.id;
  if (profile.profile_visibility === "hidden" && !isMe) {
    return NextResponse.json({ error: "This user is not visible", code: "PROFILE_HIDDEN" }, { status: 404 });
  }

  const blockedByMe = me ? isBlocked(me.id, target.id) : false;
  const blockedMe = me ? isBlocked(target.id, me.id) : false;

  let assets: { mode: string; usd?: number; digits?: number; chains?: unknown } = {
    mode: profile.assets_visibility,
  };
  if (profile.assets_visibility === "visible") {
    assets = {
      mode: "visible",
      usd: target.assets_usd ?? 0,
      chains: target.assets_detail ? JSON.parse(target.assets_detail) : [],
    };
  } else if (profile.assets_visibility === "blurred") {
    // Blurred mode reveals only the order of magnitude: one "$" per digit.
    assets = {
      mode: "blurred",
      digits: String(Math.max(0, Math.floor(target.assets_usd ?? 0))).length,
    };
  }

  const country = countryByCode(profile.country);

  const canMessage =
    !!me &&
    !isMe &&
    profile.messaging_allowed === 1 &&
    !blockedByMe &&
    !blockedMe &&
    me.account_type !== "bot";

  return NextResponse.json({
    address: target.address,
    username: profile.username,
    avatar: profile.avatar,
    avatarUrl: profile.avatar_url,
    accountType: target.account_type,
    isOrganizer: isActiveOrganizer(target.id),
    trustScore: target.trust_score,
    vpnDetected: target.vpn_detected === 1,
    bio: profile.bio,
    link: profile.link,
    gender: profile.gender_visibility === "visible" || isMe ? profile.gender : null,
    assets,
    location:
      profile.location_mode === "approx" && profile.lat != null
        ? { mode: "approx", country: country?.name ?? null }
        : { mode: "country", country: country?.name ?? null },
    canMessage,
    blockedByMe,
    isMe,
  });
}
