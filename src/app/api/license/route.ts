import { NextResponse } from "next/server";
import db, { now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import {
  checkLicense,
  licenseContract,
  organizerMinTrust,
  stakePrice,
  TIER_ORGANIZER,
  TIER_BOT,
} from "@/lib/license";

/**
 * License dashboard for the logged-in wallet: stake status for both tiers,
 * current tier prices (generation pricing), and the inviter's address so the
 * client can pass it as the on-chain referrer when staking.
 */
export async function GET() {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });

  const [organizer, bot, organizerPrice, botPrice] = await Promise.all([
    checkLicense(me.address, TIER_ORGANIZER),
    checkLicense(me.address, TIER_BOT),
    stakePrice(TIER_ORGANIZER),
    stakePrice(TIER_BOT),
  ]);

  const activeEvents = (
    db
      .prepare("SELECT COUNT(*) AS c FROM events WHERE owner_user_id = ? AND ends_at > ?")
      .get(me.id, now()) as { c: number }
  ).c;

  const inviter = me.referred_by
    ? (db.prepare("SELECT address FROM users WHERE id = ?").get(me.referred_by) as
        | { address: string }
        | undefined)
    : undefined;

  return NextResponse.json({
    contract: licenseContract(),
    minTrust: organizerMinTrust(),
    inviterAddress: inviter?.address ?? null,
    organizer: { ...organizer, price: organizerPrice.toString(), activeEvents },
    bot: { ...bot, price: botPrice.toString() },
  });
}
