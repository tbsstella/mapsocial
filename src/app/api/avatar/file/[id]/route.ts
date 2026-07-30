import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

function sniffImageType(buf: Buffer): string {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  return "image/webp";
}

/** Serve uploaded avatar images (public, like the rest of the profile). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new NextResponse(null, { status: 404 });

  const file = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(file)) return new NextResponse(null, { status: 404 });

  const bytes = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": sniffImageType(bytes),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
