import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'human' CHECK (account_type IN ('human','bot')),
  referral_code TEXT UNIQUE NOT NULL,
  referred_by INTEGER REFERENCES users(id),
  trust_score INTEGER NOT NULL DEFAULT 50,
  trust_detail TEXT,
  trust_updated_at INTEGER,
  assets_usd REAL,
  assets_detail TEXT,
  assets_updated_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  username TEXT UNIQUE NOT NULL,
  avatar TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male','female','other')),
  bio TEXT NOT NULL DEFAULT '',
  link TEXT,
  profile_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (profile_visibility IN ('visible','hidden')),
  gender_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (gender_visibility IN ('visible','hidden')),
  assets_visibility TEXT NOT NULL DEFAULT 'blurred' CHECK (assets_visibility IN ('visible','blurred','hidden')),
  location_mode TEXT NOT NULL DEFAULT 'country' CHECK (location_mode IN ('approx','country')),
  messaging_allowed INTEGER NOT NULL DEFAULT 1,
  lat REAL,
  lng REAL,
  country TEXT,
  completed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id),
  blocked_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a INTEGER NOT NULL REFERENCES users(id),
  user_b INTEGER NOT NULL REFERENCES users(id),
  initiator_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, id);

-- Approach-credit ledger (referral rewards etc.)
CREATE TABLE IF NOT EXISTS credit_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credits_user ON credit_grants(user_id, expires_at);

-- Qualified referral events (for weekly/lifetime caps)
CREATE TABLE IF NOT EXISTS referral_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_id INTEGER NOT NULL REFERENCES users(id),
  invitee_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- Organizer events shown on the map. Creation requires an active
-- LicenseStake organizer position (one position = one concurrent event).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  theme_color TEXT NOT NULL DEFAULT '#8b5cf6',
  nft_chain TEXT,
  nft_standard TEXT CHECK (nft_standard IN ('erc721','erc1155') OR nft_standard IS NULL),
  nft_contract TEXT,
  nft_token_id TEXT,
  link TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_window ON events(ends_at, starts_at);

CREATE TABLE IF NOT EXISTS event_follows (
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
`);

// Additive migrations for columns introduced after the initial schema.
for (const col of [
  "vpn_detected INTEGER NOT NULL DEFAULT 0",
  "ip_country TEXT",
  "ip_checked_at INTEGER",
]) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
  } catch {
    // column already exists
  }
}

// SIMN tips inside chats: kind='tip' messages carry the verified on-chain
// transfer (raw wei amount + tx hash). The unique index prevents replaying
// the same tx into multiple tip messages.
for (const col of [
  "kind TEXT NOT NULL DEFAULT 'text'",
  "tip_amount TEXT",
  "tip_tx TEXT",
]) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN ${col}`);
  } catch {
    // column already exists
  }
}
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tip_tx ON messages(tip_tx) WHERE tip_tx IS NOT NULL"
);

// Precise event venue: an optional human-readable address; when the creator
// geocodes it, lat/lng already hold the precise coordinates.
try {
  db.exec("ALTER TABLE events ADD COLUMN venue_address TEXT");
} catch {
  // column already exists
}

// NFT avatars: profiles.avatar holds "nft:<chain>:<contract>:<tokenId>",
// avatar_url caches the resolved image URL (NULL for system presets).
try {
  db.exec("ALTER TABLE profiles ADD COLUMN avatar_url TEXT");
} catch {
  // column already exists
}

// Bot operator config: an OpenAI-compatible endpoint that auto-answers DMs.
// This is only the built-in convenience opening — operators can instead run
// their own loop over the open API/SDK (poll threads, reply), with pricing
// and business logic entirely on their side.
// api_key is server-side only and never returned by any API.
db.exec(`
CREATE TABLE IF NOT EXISTS bot_configs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  api_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`);

export default db;

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export interface UserRow {
  id: number;
  address: string;
  account_type: "human" | "bot";
  referral_code: string;
  referred_by: number | null;
  trust_score: number;
  trust_detail: string | null;
  trust_updated_at: number | null;
  assets_usd: number | null;
  assets_detail: string | null;
  assets_updated_at: number | null;
  vpn_detected: number;
  ip_country: string | null;
  ip_checked_at: number | null;
  created_at: number;
}

export interface ProfileRow {
  user_id: number;
  username: string;
  avatar: string;
  avatar_url: string | null;
  gender: "male" | "female" | "other";
  bio: string;
  link: string | null;
  profile_visibility: "visible" | "hidden";
  gender_visibility: "visible" | "hidden";
  assets_visibility: "visible" | "blurred" | "hidden";
  location_mode: "approx" | "country";
  messaging_allowed: number;
  lat: number | null;
  lng: number | null;
  country: string | null;
  completed_at: number;
}

export function getUserByAddress(address: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE address = ?")
    .get(address.toLowerCase()) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getProfile(userId: number): ProfileRow | undefined {
  return db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as
    | ProfileRow
    | undefined;
}

/** "Event creator" = owns a live or upcoming event; drives the square
 *  avatar treatment across map, lists and profile cards. */
export function isActiveOrganizer(userId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM events WHERE owner_user_id = ? AND ends_at > ? LIMIT 1")
    .get(userId, now());
}

/** Same check in bulk for list endpoints (map users). */
export function activeOrganizerIds(): Set<number> {
  const rows = db
    .prepare("SELECT DISTINCT owner_user_id AS id FROM events WHERE ends_at > ?")
    .all(now()) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

export function isBlocked(blockerId: number, blockedId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
    .get(blockerId, blockedId);
}

export function blockedByCount(userId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM blocks WHERE blocked_id = ?")
    .get(userId) as { c: number };
  return row.c;
}

export interface BotConfigRow {
  user_id: number;
  api_url: string;
  api_key: string;
  model: string;
  system_prompt: string;
  enabled: number;
  updated_at: number;
}

export function getBotConfig(userId: number): BotConfigRow | undefined {
  return db.prepare("SELECT * FROM bot_configs WHERE user_id = ?").get(userId) as
    | BotConfigRow
    | undefined;
}
