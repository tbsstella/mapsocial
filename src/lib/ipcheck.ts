import db, { now, type UserRow } from "./db";

const RECHECK_INTERVAL_S = 24 * 60 * 60;

/** Private/loopback ranges cannot be geolocated (local dev, LAN). */
function isPrivateIp(ip: string): boolean {
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("fc") ||
    ip.startsWith("fe80")
  );
}

export function requestIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip");
}

interface IpIntel {
  vpn: boolean;
  country: string | null;
}

/**
 * IP intelligence via ip-api.com (free tier; swap via IP_CHECK_URL for a
 * commercial provider in production). `proxy` covers VPN/proxy exit nodes,
 * `hosting` covers datacenter IPs commonly used by VPNs.
 */
async function lookupIp(ip: string): Promise<IpIntel | null> {
  const base = process.env.IP_CHECK_URL ?? "http://ip-api.com/json";
  try {
    const res = await fetch(`${base}/${ip}?fields=status,countryCode,proxy,hosting`, {
      signal: AbortSignal.timeout(4000),
    });
    const data = (await res.json()) as {
      status?: string;
      countryCode?: string;
      proxy?: boolean;
      hosting?: boolean;
    };
    if (data.status !== "success") return null;
    return {
      vpn: Boolean(data.proxy || data.hosting),
      country: data.countryCode ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Refresh the user's VPN flag from the current request IP, at most once per
 * 24h. Fails open (keeps the previous flag) if lookup is unavailable.
 */
export async function refreshVpnStatus(user: UserRow, headers: Headers): Promise<void> {
  if (user.ip_checked_at && now() - user.ip_checked_at < RECHECK_INTERVAL_S) return;

  const ip = requestIp(headers);
  if (!ip || isPrivateIp(ip)) {
    db.prepare("UPDATE users SET ip_checked_at = ? WHERE id = ?").run(now(), user.id);
    return;
  }

  const intel = await lookupIp(ip);
  if (!intel) {
    db.prepare("UPDATE users SET ip_checked_at = ? WHERE id = ?").run(now(), user.id);
    return;
  }

  db.prepare(
    "UPDATE users SET vpn_detected = ?, ip_country = ?, ip_checked_at = ? WHERE id = ?"
  ).run(intel.vpn ? 1 : 0, intel.country, now(), user.id);

  // Country is IP-derived (not user-editable); keep the profile in sync.
  if (intel.country) {
    db.prepare("UPDATE profiles SET country = ? WHERE user_id = ?").run(
      intel.country,
      user.id
    );
  }
}
