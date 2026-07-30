import { NextRequest, NextResponse } from "next/server";
import db, { now, getProfile } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { checkLicense, organizerMinTrust, TIER_ORGANIZER } from "@/lib/license";
import { validateProfileLink } from "@/lib/linkfilter";
import { APP_CHAINS } from "@/lib/chains";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_DURATION_S = 30 * 24 * 60 * 60;

interface EventRow {
  id: number;
  owner_user_id: number;
  title: string;
  description: string;
  lat: number;
  lng: number;
  starts_at: number;
  ends_at: number;
  theme_color: string;
  nft_chain: string | null;
  nft_standard: string | null;
  nft_contract: string | null;
  nft_token_id: string | null;
  link: string | null;
  venue_address: string | null;
  username: string | null;
  address: string;
}

function serialize(e: EventRow, t: number) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    lat: e.lat,
    lng: e.lng,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    themeColor: e.theme_color,
    live: e.starts_at <= t && e.ends_at > t,
    nftGate: e.nft_contract
      ? {
          chainKey: e.nft_chain,
          standard: e.nft_standard,
          contract: e.nft_contract,
          tokenId: e.nft_token_id,
        }
      : null,
    link: e.link,
    venue: e.venue_address,
    organizer: { address: e.address, username: e.username },
  };
}

/** Public list of upcoming + live events. */
export async function GET() {
  const t = now();
  const rows = db
    .prepare(
      `SELECT e.*, p.username, u.address
       FROM events e
       JOIN users u ON u.id = e.owner_user_id
       LEFT JOIN profiles p ON p.user_id = e.owner_user_id
       WHERE e.ends_at > ?
       ORDER BY e.starts_at ASC
       LIMIT 200`
    )
    .all(t) as EventRow[];
  return NextResponse.json({ events: rows.map((e) => serialize(e, t)) });
}

/**
 * Create an event. Requires:
 *  - SIWE session (human account)
 *  - an active organizer license position (LicenseStake on Ethereum);
 *    concurrent events are capped by the number of active positions
 *  - trust score above the configured floor (safety valve)
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });
  if (me.account_type === "bot")
    return NextResponse.json(
      { error: "机器人账号不能创建活动", code: "BOT_NO_INIT" },
      { status: 403 }
    );
  if (!getProfile(me.id))
    return NextResponse.json(
      { error: "请先完成 Profile", code: "MISSING_FIELDS" },
      { status: 400 }
    );
  if (me.trust_score < organizerMinTrust())
    return NextResponse.json(
      { error: "可信度分数不足，无法创建活动", code: "TRUST_TOO_LOW" },
      { status: 403 }
    );

  const license = await checkLicense(me.address, TIER_ORGANIZER);
  if (!license.ok)
    return NextResponse.json(
      { error: "需要主办方牌照（质押 SIMN 获得）", code: "LICENSE_REQUIRED" },
      { status: 403 }
    );

  const t = now();
  const activeEvents = (
    db
      .prepare("SELECT COUNT(*) AS c FROM events WHERE owner_user_id = ? AND ends_at > ?")
      .get(me.id, t) as { c: number }
  ).c;
  if (activeEvents >= license.slots)
    return NextResponse.json(
      { error: "活动名额已用满（一个质押仓位 = 一个进行中的活动）", code: "EVENT_LIMIT" },
      { status: 429 }
    );

  const b = (await req.json()) as Record<string, unknown>;

  const title = String(b.title ?? "").trim();
  const description = String(b.description ?? "").trim().slice(0, 500);
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const startsAt = Number(b.startsAt);
  const endsAt = Number(b.endsAt);
  const themeColor = String(b.themeColor ?? "#8b5cf6");
  const venue = b.venue ? String(b.venue).trim().slice(0, 200) : null;

  const bad = (msg: string) =>
    NextResponse.json({ error: msg, code: "EVENT_INVALID" }, { status: 400 });

  if (title.length < 3 || title.length > 80) return bad("标题需 3-80 字");
  if (!Number.isFinite(lat) || lat < -85 || lat > 85) return bad("纬度无效");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return bad("经度无效");
  if (!Number.isInteger(startsAt) || !Number.isInteger(endsAt)) return bad("时间无效");
  if (endsAt <= t) return bad("结束时间必须在未来");
  if (endsAt <= startsAt) return bad("结束时间必须晚于开始时间");
  if (endsAt - startsAt > MAX_DURATION_S) return bad("活动时长不能超过 30 天");
  if (!HEX_COLOR_RE.test(themeColor)) return bad("主题色必须是 #rrggbb 格式");

  // Optional NFT gate
  let nft: { chain: string; standard: string; contract: string; tokenId: string | null } | null =
    null;
  if (b.nftContract) {
    const contract = String(b.nftContract);
    const chainKey = String(b.nftChain ?? "");
    const standard = String(b.nftStandard ?? "erc721");
    const tokenId = b.nftTokenId != null ? String(b.nftTokenId) : null;
    if (!ADDRESS_RE.test(contract)) return bad("NFT 合约地址无效");
    if (!APP_CHAINS.some((c) => c.key === chainKey)) return bad("NFT 所在链不支持");
    if (!["erc721", "erc1155"].includes(standard)) return bad("NFT 标准只支持 erc721/erc1155");
    if (standard === "erc1155" && (tokenId == null || !/^\d+$/.test(tokenId)))
      return bad("erc1155 必须提供数字 tokenId");
    nft = { chain: chainKey, standard, contract, tokenId };
  }

  let link: string | null = null;
  if (b.link) {
    const check = validateProfileLink(String(b.link));
    if (!check.ok)
      return NextResponse.json(
        { error: `链接不允许（${check.code}）`, code: check.code },
        { status: 400 }
      );
    link = check.url ?? null;
  }

  const res = db
    .prepare(
      `INSERT INTO events
        (owner_user_id, title, description, lat, lng, starts_at, ends_at, theme_color,
         nft_chain, nft_standard, nft_contract, nft_token_id, link, venue_address, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      me.id,
      title,
      description,
      lat,
      lng,
      startsAt,
      endsAt,
      themeColor,
      nft?.chain ?? null,
      nft?.standard ?? null,
      nft?.contract ?? null,
      nft?.tokenId ?? null,
      link,
      venue,
      t
    );

  return NextResponse.json({
    ok: true,
    eventId: Number(res.lastInsertRowid),
    licenseDevMode: license.devMode,
  });
}
