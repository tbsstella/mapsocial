"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface Me {
  user: {
    address: string;
    accountType: "human" | "bot";
    isOrganizer: boolean;
    trustScore: number;
    trustDetail: {
      base?: number;
      activity: number;
      assets: number;
      diversity: number;
      penalty: number;
    } | null;
    assetsUsd: number | null;
    assetsDetail:
      | { key: string; label: string; txCount: number; totalUsd: number; error?: boolean }[]
      | null;
    referralCode: string;
    vpnDetected: boolean;
  } | null;
  profile: {
    username: string;
    avatar: string;
    avatar_url: string | null;
    gender: string;
    bio: string;
    link: string | null;
    profile_visibility: string;
    gender_visibility: string;
    assets_visibility: string;
    location_mode: string;
    messaging_allowed: number;
    country: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  quota: { base: number; bonus: number; consumed: number; remaining: number } | null;
  referral: {
    invitedCount: number;
    credits: { amount: number; reason: string; expires_at: number }[];
    config: { inviterCredits: number; inviteeCredits: number; creditTtlDays: number };
  } | null;
}

export function useMe() {
  const query = useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/me");
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
    staleTime: 30_000,
  });
  const queryClient = useQueryClient();
  return {
    ...query,
    me: query.data ?? null,
    invalidate: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  };
}
