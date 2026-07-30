"use client";

import { useCallback, useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { apiErrorText, useI18n } from "@/lib/i18n";

export function useSiweLogin(onSuccess?: (isNew: boolean) => void) {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (accountType: "human" | "bot") => {
      setBusy(true);
      setError(null);
      try {
        let addr = address;
        if (!isConnected || !addr) {
          const injectedConnector = connectors[0];
          if (!injectedConnector) throw new Error(t("login.noWallet"));
          const result = await connectAsync({ connector: injectedConnector });
          addr = result.accounts[0];
        }
        if (!addr) throw new Error(t("login.noAddress"));

        const nonceRes = await fetch("/api/auth/nonce", { method: "POST" });
        const { nonce } = (await nonceRes.json()) as { nonce: string };

        const message = createSiweMessage({
          address: addr,
          chainId: 1,
          domain: window.location.host,
          nonce,
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
        const data = (await verifyRes.json()) as {
          ok?: boolean;
          isNew?: boolean;
          error?: string;
          code?: string;
        };
        if (!verifyRes.ok || !data.ok) throw new Error(apiErrorText(data, t));

        localStorage.removeItem("refCode");
        onSuccess?.(data.isNew ?? false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("login.failed");
        setError(msg.includes("User rejected") ? t("login.rejected") : msg);
      } finally {
        setBusy(false);
      }
    },
    [address, isConnected, connectAsync, connectors, signMessageAsync, onSuccess, t]
  );

  return { login, busy, error };
}
