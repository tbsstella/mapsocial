import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/session";
import { checkImage } from "@/lib/moderation";

/**
 * Custom avatar upload. The client resizes/crops to a small square via
 * canvas before uploading (which also strips EXIF), so payloads stay tiny.
 * Server side: magic-byte type sniffing, size cap, moderation hook, then
 * the file is stored per-user and served by /api/avatar/file/[id].
 */

const MAX_BYTES = 512 * 1024;
export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

function sniffImageType(buf: Buffer): string | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "latin1")))
    return "image/png";
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return null;
}

export async function POST(req: NextRequest) {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });

  const b = (await req.json()) as { data?: string };
  const dataUrl = String(b.data ?? "");
  const m = dataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m)
    return NextResponse.json({ error: "Invalid avatar", code: "AVATAR_INVALID" }, { status: 400 });

  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length > MAX_BYTES)
    return NextResponse.json({ error: "Image too large", code: "AVATAR_TOO_LARGE" }, { status: 400 });

  // Never trust the declared mime type; sniff the real bytes.
  const mime = sniffImageType(bytes);
  if (!mime)
    return NextResponse.json({ error: "Invalid avatar", code: "AVATAR_INVALID" }, { status: 400 });

  const moderation = await checkImage(bytes, mime);
  if (!moderation.ok)
    return NextResponse.json(
      { error: "Image failed the compliance check", code: "AVATAR_NSFW" },
      { status: 400 }
    );

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, String(me.id)), bytes);

  return NextResponse.json({
    ok: true,
    url: `/api/avatar/file/${me.id}?v=${Date.now()}`,
    moderated: !moderation.skipped,
  });
}
