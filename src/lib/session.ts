import { cookies } from "next/headers";
import crypto from "node:crypto";
import db, { now, getUserById, type UserRow } from "./db";

const SESSION_COOKIE = "wsm_session";
const SESSION_TTL_S = 30 * 24 * 60 * 60;
const NONCE_TTL_S = 10 * 60;

export function createNonce(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO auth_nonces (nonce, created_at, expires_at) VALUES (?,?,?)").run(
    nonce,
    now(),
    now() + NONCE_TTL_S
  );
  return nonce;
}

/** Consumes the nonce (single use). Returns whether it was valid. */
export function consumeNonce(nonce: string): boolean {
  const res = db
    .prepare("DELETE FROM auth_nonces WHERE nonce = ? AND expires_at > ?")
    .run(nonce, now());
  db.prepare("DELETE FROM auth_nonces WHERE expires_at <= ?").run(now());
  return res.changes === 1;
}

export async function createSession(userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)").run(
    token,
    userId,
    now() + SESSION_TTL_S
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_S,
    path: "/",
  });
}

export async function getSessionUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare("SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now()) as { user_id: number } | undefined;
  if (!row) return null;
  return getUserById(row.user_id) ?? null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  store.delete(SESSION_COOKIE);
}
