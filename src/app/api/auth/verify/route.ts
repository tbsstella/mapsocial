import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import db, { now, getUserByAddress, type UserRow } from "@/lib/db";
import { consumeNonce, createSession } from "@/lib/session";
import { generateReferralCode, findInviterByCode } from "@/lib/referral";
import { refreshUserTrust } from "@/lib/trust";
import { refreshVpnStatus } from "@/lib/ipcheck";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    message?: string;
    signature?: `0x${string}`;
    accountType?: string;
    refCode?: string;
  };
  if (!body.message || !body.signature) {
    return NextResponse.json({ error: "Missing required fields", code: "MISSING_FIELDS" }, { status: 400 });
  }

  const parsed = parseSiweMessage(body.message);
  if (!parsed.address || !parsed.nonce) {
    return NextResponse.json({ error: "Invalid SIWE message", code: "SIWE_INVALID" }, { status: 400 });
  }
  if (!consumeNonce(parsed.nonce)) {
    return NextResponse.json({ error: "Nonce invalid or expired", code: "NONCE_INVALID" }, { status: 400 });
  }

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: body.message,
      signature: body.signature,
    });
  } catch {
    return NextResponse.json({ error: "Signature verification failed", code: "SIG_INVALID" }, { status: 401 });
  }
  if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
    return NextResponse.json({ error: "Signature does not match address", code: "SIG_MISMATCH" }, { status: 401 });
  }

  const address = parsed.address.toLowerCase();
  let user = getUserByAddress(address);
  let isNew = false;

  if (!user) {
    isNew = true;
    const accountType = body.accountType === "bot" ? "bot" : "human";
    const referredBy = body.refCode ? findInviterByCode(body.refCode) : null;
    // Retry on the (unlikely) referral-code collision.
    for (let attempt = 0; attempt < 3 && !user; attempt++) {
      try {
        db.prepare(
          `INSERT INTO users (address, account_type, referral_code, referred_by, created_at)
           VALUES (?,?,?,?,?)`
        ).run(address, accountType, generateReferralCode(), referredBy, now());
        user = getUserByAddress(address);
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
  }

  if (!user) {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }

  await createSession(user.id);

  // Fire-and-forget initial on-chain scoring and VPN check so login stays fast.
  if (isNew) {
    void refreshUserTrust(user as UserRow, true).catch(() => {});
  }
  void refreshVpnStatus(user, req.headers).catch(() => {});

  return NextResponse.json({ ok: true, isNew, address });
}
