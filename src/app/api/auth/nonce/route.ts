import { NextResponse } from "next/server";
import { createNonce } from "@/lib/session";

export async function POST() {
  return NextResponse.json({ nonce: createNonce() });
}
