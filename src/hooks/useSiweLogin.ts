"use client";

import { useCallback, useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import type { Connector } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { apiErrorText, useI18n } from "@/lib/i18n";

/**
 * Pick the first connector that actually has a provider. EIP-6963-announced
 * wallets (real extensions) are preferred over the bare "injected" fallback,
 * which exists even when no wallet is installed and would otherwise throw
 * wagmi's raw "Provider not found" only after a slow connect attempt.
 */
async function pickConnector(connectors: readonly Connector[]): Promise<Connector | null> {
  const ordered = [
    ...connectors.filter((c) => c.id !== "injected"),
    ...connectors.filter((c) => c.id === "injected"),
  ];
  for (const c of ordered) {
    const provider = await c.getProvider().catch(() => null);
    if (provider) return c;
  }
  return null;
}

/** Parse a JSON response defensively: HTML error pages must not crash the flow. */
async function readJson<T>(res: Response): Promise<T | null> {
  return (await res.json().catch(() => null)) as T | null;
}

/**
 * Human-readable text for a wagmi/viem error. Those errors carry a concise
 * `shortMessage` (and the wallet's own text in `details`); `message` appends
 * request args, docs links and library versions, which is noise for users.
 */
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return "";
  const err = e as Error & { shortMessage?: string; details?: string };
  return err.shortMessage ?? err.details ?? err.message;
}

export function useSiweLogin(onSuccess?: (isNew: boolean) => void) {
  const { address, isConnected, connector: activeConnector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (accountType: "human" | "bot", chosen?: Connector) => {
      setBusy(true);
      setError(null);
      try {
        // Fetch the nonce in parallel with the wallet connect popup so the
        // signature prompt appears as soon as the wallet is connected.
        const noncePromise = fetch("/api/auth/nonce", { method: "POST" }).catch(() => null);

        let addr = address;
        let connector = chosen ?? activeConnector;
        const needConnect =
          !isConnected || !addr || (chosen && activeConnector?.id !== chosen.id);
        if (needConnect) {
          connector = chosen ?? (await pickConnector(connectors)) ?? undefined;
          if (!connector) throw new Error(t("login.noWallet"));
          // No chainId here on purpose: multi-chain wallets (e.g. Phantom,
          // which only serves Ethereum/Polygon/Base/Monad) must not be forced
          // to switch to a chain they don't support just to sign in.
          const result = await connectAsync({ connector });
          addr = result.accounts[0];
        }
        if (!addr) throw new Error(t("login.noAddress"));

        const nonceRes = await noncePromise;
        const nonceData = nonceRes?.ok
          ? await readJson<{ nonce?: string }>(nonceRes)
          : null;
        if (!nonceData?.nonce) throw new Error(t("login.failed"));

        const message = createSiweMessage({
          address: addr,
          chainId: 1,
          domain: window.location.host,
          nonce: nonceData.nonce,
          uri: window.location.origin,
          version: "1",
          statement: t("login.siweStatement"),
        });

        // Sign through the connector we just connected with. Without it wagmi
        // compares the wallet's live chain against the chain recorded when the
        // connection was created and throws ConnectorChainMismatchError —
        // wallets that silently switch their per-dapp chain right after
        // connecting (Phantom does this) trip that check. Passing the
        // connector makes wagmi read the wallet's current state instead.
        const signature = await signMessageAsync({
          message,
          account: addr,
          connector,
        });

        const refCode = localStorage.getItem("refCode") ?? undefined;
        const verifyRes = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, signature, accountType, refCode }),
        });
        const data = await readJson<{
          ok?: boolean;
          isNew?: boolean;
          error?: string;
          code?: string;
        }>(verifyRes);
        if (!verifyRes.ok || !data?.ok) throw new Error(apiErrorText(data, t));

        localStorage.removeItem("refCode");
        onSuccess?.(data.isNew ?? false);
      } catch (e) {
        const msg = errorText(e) || t("login.failed");
        const code = (e as { code?: number })?.code;
        if (code === 4001 || msg.includes("User rejected")) {
          setError(t("login.rejected"));
        } else if (msg.includes("Provider not found")) {
          setError(t("login.noWallet"));
        } else {
          setError(msg);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      address,
      isConnected,
      activeConnector,
      connectAsync,
      connectors,
      signMessageAsync,
      onSuccess,
      t,
    ]
  );

  return { login, busy, error };
}
