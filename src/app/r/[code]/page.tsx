"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReferralLanding({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const router = useRouter();

  useEffect(() => {
    localStorage.setItem("refCode", code);
    router.replace("/");
  }, [code, router]);

  return (
    <div className="flex h-dvh items-center justify-center text-sm text-slate-400">
      Opening invite…
    </div>
  );
}
