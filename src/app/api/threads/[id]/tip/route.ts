import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseEventLogs, erc20Abi, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import db, { isBlocked, now } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { MEME_TOKEN, rpcUrl } from "@/lib/chains";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl("ethereum"), { timeout: 8000 }),
});

interface ThreadRow {
  id: number;
  user_a: number;
  user_b: number;
}

function fmtAmount(wei: bigint): string {
  const s = formatUnits(wei, MEME_TOKEN.decimals);
  // trim trailing zeros for display ("2000.0" -> "2000")
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Record a SIMN tip in the chat. The transfer itself happens wallet-to-wallet
 * on Ethereum; we only verify the tx on-chain (real Transfer on the SIMN
 * contract, from me, to the counterpart) and store it as a 'tip' message.
 * Tips bypass approach quota and the reply gate, but respect blocks.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await params;
  const t = db.prepare("SELECT id, user_a, user_b FROM threads WHERE id = ?").get(Number(id)) as
    | ThreadRow
    | undefined;
  if (!t || (t.user_a !== me.id && t.user_b !== me.id))
    return NextResponse.json(
      { error: "Conversation not found", code: "THREAD_NOT_FOUND" },
      { status: 404 }
    );

  const otherId = t.user_a === me.id ? t.user_b : t.user_a;
  if (isBlocked(me.id, otherId) || isBlocked(otherId, me.id))
    return NextResponse.json(
      { error: "You can't send messages in this conversation", code: "CANNOT_SEND" },
      { status: 403 }
    );

  const body = (await req.json()) as { txHash?: string };
  const txHash = String(body.txHash ?? "").toLowerCase();
  if (!TX_HASH_RE.test(txHash))
    return NextResponse.json(
      { error: "Invalid transaction hash", code: "TIP_TX_INVALID" },
      { status: 400 }
    );

  const dup = db.prepare("SELECT 1 FROM messages WHERE tip_tx = ?").get(txHash);
  if (dup)
    return NextResponse.json(
      { error: "This transaction was already recorded", code: "TIP_TX_USED" },
      { status: 409 }
    );

  const otherAddress = (
    db.prepare("SELECT address FROM users WHERE id = ?").get(otherId) as { address: string }
  ).address;

  // The client waits for confirmation before posting, but public RPCs can
  // lag a block or two behind, so retry briefly before giving up.
  let receipt = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!receipt)
    return NextResponse.json(
      { error: "Transaction not found on-chain", code: "TIP_TX_NOT_FOUND" },
      { status: 400 }
    );
  if (receipt.status !== "success")
    return NextResponse.json(
      { error: "Transaction failed on-chain", code: "TIP_TX_FAILED" },
      { status: 400 }
    );

  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs,
  }).filter(
    (log) =>
      log.address.toLowerCase() === MEME_TOKEN.address.toLowerCase() &&
      log.args.from.toLowerCase() === me.address.toLowerCase() &&
      log.args.to.toLowerCase() === otherAddress.toLowerCase() &&
      log.args.value > 0n
  );
  if (transfers.length === 0)
    return NextResponse.json(
      { error: "Not a SIMN transfer to this person", code: "TIP_TX_MISMATCH" },
      { status: 400 }
    );

  const amount = transfers.reduce((sum, log) => sum + log.args.value, 0n);
  const tNow = now();
  try {
    db.prepare(
      `INSERT INTO messages (thread_id, sender_id, body, created_at, kind, tip_amount, tip_tx)
       VALUES (?,?,?,?,'tip',?,?)`
    ).run(t.id, me.id, `🎁 ${fmtAmount(amount)} SIMN`, tNow, amount.toString(), txHash);
  } catch {
    // unique index race on tip_tx
    return NextResponse.json(
      { error: "This transaction was already recorded", code: "TIP_TX_USED" },
      { status: 409 }
    );
  }
  db.prepare("UPDATE threads SET last_message_at = ? WHERE id = ?").run(tNow, t.id);

  return NextResponse.json({ ok: true, amount: amount.toString() });
}
