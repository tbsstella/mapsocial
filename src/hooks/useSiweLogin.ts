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
        const needConnect =
          !isConnected || !addr || (chosen && activeConnector?.id !== chosen.id);
        if (needConnect) {
          const connector = chosen ?? (await pickConnector(connectors));
          if (!connector) throw new Error(t("login.noWallet"));
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

        const signature = await signMessageAsync({ message });

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
        const msg = e instanceof Error ? e.message : t("login.failed");
        if (msg.includes("User rejected")) setError(t("login.rejected"));
        else if (msg.includes("Provider not found")) setError(t("login.noWallet"));
        else setError(msg);
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
