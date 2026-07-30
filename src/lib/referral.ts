import crypto from "node:crypto";
import db, { now } from "./db";

export const REFERRAL_CONFIG = {
  inviterCredits: 3,
  inviteeCredits: 2,
  creditTtlDays: 30,
  weeklyQualifiedCap: 10,
  lifetimeBonusCap: 30,
};

export function generateReferralCode(): string {
  // 8-char base32-ish, collision-checked by unique constraint at insert.
  return crypto.randomBytes(5).toString("base64url").slice(0, 8).toLowerCase();
}

export function findInviterByCode(code: string): number | null {
  const row = db
    .prepare("SELECT id FROM users WHERE referral_code = ?")
    .get(code.toLowerCase().trim()) as { id: number } | undefined;
  return row?.id ?? null;
}

function grantedLifetime(userId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM credit_grants WHERE user_id = ? AND reason LIKE 'referral%'"
    )
    .get(userId) as { s: number };
  return row.s;
}

function qualifiedThisWeek(inviterId: number): number {
  const weekAgo = now() - 7 * 24 * 60 * 60;
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM referral_events WHERE inviter_id = ? AND created_at > ?")
    .get(inviterId, weekAgo) as { c: number };
  return row.c;
}

function grant(userId: number, amount: number, reason: string): void {
  db.prepare(
    "INSERT INTO credit_grants (user_id, amount, reason, created_at, expires_at) VALUES (?,?,?,?,?)"
  ).run(userId, amount, reason, now(), now() + REFERRAL_CONFIG.creditTtlDays * 86400);
}

/**
 * Called once when an invitee completes their profile.
 * Applies weekly and lifetime caps; bots earn no approach credits.
 */
export function processQualifiedReferral(
  inviterId: number,
  inviteeId: number,
  inviteeIsBot: boolean
): void {
  const already = db
    .prepare("SELECT 1 FROM referral_events WHERE invitee_id = ?")
    .get(inviteeId);
  if (already) return;

  db.prepare(
    "INSERT INTO referral_events (inviter_id, invitee_id, created_at) VALUES (?,?,?)"
  ).run(inviterId, inviteeId, now());

  if (qualifiedThisWeek(inviterId) <= REFERRAL_CONFIG.weeklyQualifiedCap) {
    const room = REFERRAL_CONFIG.lifetimeBonusCap - grantedLifetime(inviterId);
    const amount = Math.min(REFERRAL_CONFIG.inviterCredits, Math.max(0, room));
    if (amount > 0) grant(inviterId, amount, "referral_inviter");
  }

  if (!inviteeIsBot) {
    grant(inviteeId, REFERRAL_CONFIG.inviteeCredits, "referral_invitee");
  }
}
