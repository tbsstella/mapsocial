import { NextRequest, NextResponse } from "next/server";
import db, { getProfile, now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { validateProfileLink } from "@/lib/linkfilter";
import { countryByCode } from "@/lib/countries";
import { processQualifiedReferral } from "@/lib/referral";
import fs from "node:fs";
import path from "node:path";
import { AVATAR_IDS, AVATAR_CUSTOM } from "@/lib/avatars";

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/;

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });

  const b = (await req.json()) as Record<string, unknown>;

  const username = String(b.username ?? "").trim();
  if (!USERNAME_RE.test(username))
    return NextResponse.json(
      { error: "用户名需为 2-20 位字母/数字/下划线/中文", code: "USERNAME_INVALID" },
      { status: 400 }
    );

  const taken = db
    .prepare("SELECT user_id FROM profiles WHERE username = ? AND user_id != ?")
    .get(username, user.id);
  if (taken)
    return NextResponse.json({ error: "用户名已被占用", code: "USERNAME_TAKEN" }, { status: 400 });

  // Avatar: a system preset, or "custom" when an image was uploaded
  // beforehand via POST /api/avatar (validated + moderated there).
  const avatar = String(b.avatar ?? "");
  let avatarUrl: string | null = null;
  if (avatar === AVATAR_CUSTOM) {
    const file = path.join(process.cwd(), "data", "uploads", String(user.id));
    if (!fs.existsSync(file))
      return NextResponse.json({ error: "头像无效", code: "AVATAR_INVALID" }, { status: 400 });
    avatarUrl = `/api/avatar/file/${user.id}?v=${Math.floor(fs.statSync(file).mtimeMs)}`;
  } else if (!AVATAR_IDS.includes(avatar)) {
    return NextResponse.json({ error: "头像无效", code: "AVATAR_INVALID" }, { status: 400 });
  }

  // Gender is a one-time choice: once the profile exists it can never change.
  const existingProfile = getProfile(user.id);
  const gender = existingProfile
    ? existingProfile.gender
    : String(b.gender ?? "");
  if (!["male", "female", "other"].includes(gender))
    return NextResponse.json({ error: "性别只能是 男/女/其他", code: "GENDER_INVALID" }, { status: 400 });

  const bio = String(b.bio ?? "").slice(0, 280);

  const linkCheck = validateProfileLink(String(b.link ?? ""));
  if (!linkCheck.ok)
    return NextResponse.json(
      { error: `链接不允许（${linkCheck.code}）`, code: linkCheck.code },
      { status: 400 }
    );

  const enumOr = (v: unknown, allowed: string[], fallback: string) =>
    allowed.includes(String(v)) ? String(v) : fallback;

  const profileVisibility = enumOr(b.profileVisibility, ["visible", "hidden"], "visible");
  const genderVisibility = enumOr(b.genderVisibility, ["visible", "hidden"], "visible");
  const assetsVisibility = enumOr(b.assetsVisibility, ["visible", "blurred", "hidden"], "blurred");
  const locationMode = enumOr(b.locationMode, ["approx", "country"], "country");
  const messagingAllowed = b.messagingAllowed === false ? 0 : 1;

  // Location: approx mode stores coordinates rounded to ~11 km; never precise.
  let lat: number | null = null;
  let lng: number | null = null;
  if (locationMode === "approx" && typeof b.lat === "number" && typeof b.lng === "number") {
    lat = Math.round(b.lat * 10) / 10;
    lng = Math.round(b.lng * 10) / 10;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      lat = null;
      lng = null;
    }
  }

  const existing = existingProfile;

  // Country is IP-derived, never user-chosen. Client-provided value is only
  // honored as a dev fallback when the request IP can't be geolocated
  // (private/loopback IPs in local development).
  const country =
    (user.ip_country && countryByCode(user.ip_country) ? user.ip_country : null) ??
    (countryByCode(String(b.country ?? "")) ? String(b.country) : null) ??
    existing?.country ??
    null;
  if (existing) {
    db.prepare(
      `UPDATE profiles SET username=?, avatar=?, avatar_url=?, gender=?, bio=?, link=?,
       profile_visibility=?, gender_visibility=?, assets_visibility=?,
       location_mode=?, messaging_allowed=?, lat=?, lng=?, country=? WHERE user_id=?`
    ).run(
      username, avatar, avatarUrl, gender, bio, linkCheck.url ?? null,
      profileVisibility, genderVisibility, assetsVisibility,
      locationMode, messagingAllowed, lat, lng, country, user.id
    );
  } else {
    db.prepare(
      `INSERT INTO profiles (user_id, username, avatar, avatar_url, gender, bio, link,
       profile_visibility, gender_visibility, assets_visibility,
       location_mode, messaging_allowed, lat, lng, country, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      user.id, username, avatar, avatarUrl, gender, bio, linkCheck.url ?? null,
      profileVisibility, genderVisibility, assetsVisibility,
      locationMode, messagingAllowed, lat, lng, country, now()
    );

    // First-time completion → qualified referral rewards.
    if (user.referred_by) {
      processQualifiedReferral(user.referred_by, user.id, user.account_type === "bot");
    }
  }

  return NextResponse.json({ ok: true });
}
