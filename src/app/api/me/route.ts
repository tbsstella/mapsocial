import { NextRequest, NextResponse } from "next/server";
import db, { getProfile, isActiveOrganizer, now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { refreshUserTrust } from "@/lib/trust";
import { getQuota } from "@/lib/quota";
import { REFERRAL_CONFIG } from "@/lib/referral";
import { refreshVpnStatus } from "@/lib/ipcheck";

export async function GET(req: NextRequest) {
  let user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });

  user = await refreshUserTrust(user); // no-op unless stale (daily)
  await refreshVpnStatus(user, req.headers); // no-op unless stale (daily)
  const profile = getProfile(user.id) ?? null;
  const quota = getQuota(user.id, user.trust_score);

  const invitedCount = (
    db
      .prepare("SELECT COUNT(*) AS c FROM referral_events WHERE inviter_id = ?")
      .get(user.id) as { c: number }
  ).c;

  const creditRows = db
    .prepare(
      "SELECT amount, reason, expires_at FROM credit_grants WHERE user_id = ? AND expires_at > ? ORDER BY expires_at"
    )
    .all(user.id, now());

  return NextResponse.json({
    user: {
      address: user.address,
      accountType: user.account_type,
      isOrganizer: isActiveOrganizer(user.id),
      trustScore: user.trust_score,
      trustDetail: user.trust_detail ? JSON.parse(user.trust_detail) : null,
      assetsUsd: user.assets_usd,
      assetsDetail: user.assets_detail ? JSON.parse(user.assets_detail) : null,
      referralCode: user.referral_code,
      vpnDetected: user.vpn_detected === 1,
    },
    profile,
    quota,
    referral: {
      invitedCount,
      credits: creditRows,
      config: REFERRAL_CONFIG,
    },
  });
}
