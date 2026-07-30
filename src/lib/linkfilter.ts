const BLOCKED_HOSTS = new Set([
  // URL shorteners hide destinations; disallow them outright.
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "shorturl.at",
  "t.ly",
  "s.id",
]);

const BLOCKED_TLDS = ["zip", "mov"]; // frequently abused for phishing

export type LinkErrorCode =
  | "LINK_TOO_LONG"
  | "LINK_INVALID"
  | "LINK_NOT_HTTPS"
  | "LINK_CREDS"
  | "LINK_IP"
  | "LINK_PUNYCODE"
  | "LINK_SHORTENER"
  | "LINK_TLD"
  | "LINK_BAD_DOMAIN";

export interface LinkCheckResult {
  ok: boolean;
  url?: string;
  code?: LinkErrorCode;
}

/**
 * Conservative allowlist-style validation for profile links.
 * Real deployments should additionally check against live threat-intel
 * feeds (e.g. Google Safe Browsing) before rendering links.
 */
export function validateProfileLink(raw: string): LinkCheckResult {
  const input = raw.trim();
  if (!input) return { ok: true, url: undefined };
  if (input.length > 200) return { ok: false, code: "LINK_TOO_LONG" };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: "LINK_INVALID" };
  }

  if (url.protocol !== "https:") return { ok: false, code: "LINK_NOT_HTTPS" };
  if (url.username || url.password) return { ok: false, code: "LINK_CREDS" };

  const host = url.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":"))
    return { ok: false, code: "LINK_IP" };
  if (host.startsWith("xn--") || host.includes(".xn--"))
    return { ok: false, code: "LINK_PUNYCODE" };
  if (BLOCKED_HOSTS.has(host)) return { ok: false, code: "LINK_SHORTENER" };
  const tld = host.split(".").pop() ?? "";
  if (BLOCKED_TLDS.includes(tld)) return { ok: false, code: "LINK_TLD" };
  if (!host.includes(".")) return { ok: false, code: "LINK_BAD_DOMAIN" };

  return { ok: true, url: url.toString() };
}
