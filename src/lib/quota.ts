import db, { now } from "./db";

/** Base daily approach (cold-DM) slots by score band. Resets at 00:00 UTC.
 *  Bands assume the 50-base scale: a fresh wallet (50) gets a usable 3/day,
 *  on-chain history earns more, and only penalized accounts fall to 1. */
export function baseQuota(trustScore: number): number {
  if (trustScore >= 85) return 15;
  if (trustScore >= 70) return 8;
  if (trustScore >= 50) return 3;
  if (trustScore >= 30) return 2;
  return 1;
}

/** Unexpired referral bonus credits. */
export function bonusCredits(userId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM credit_grants WHERE user_id = ? AND expires_at > ?"
    )
    .get(userId, now()) as { s: number };
  return row.s;
}

/** Threads this user initiated since 00:00 UTC today. */
export function consumedSlots(userId: number): number {
  const t = now();
  const dayStart = t - (t % 86400);
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM threads WHERE initiator_id = ? AND created_at >= ?"
    )
    .get(userId, dayStart) as { c: number };
  return row.c;
}

export interface QuotaInfo {
  base: number;
  bonus: number;
  consumed: number;
  remaining: number;
}

export function getQuota(userId: number, trustScore: number): QuotaInfo {
  const base = baseQuota(trustScore);
  const bonus = bonusCredits(userId);
  const consumed = consumedSlots(userId);
  return { base, bonus, consumed, remaining: Math.max(0, base + bonus - consumed) };
}
