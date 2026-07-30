"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Chat now lives in floating cards on the map; keep the route as a redirect. */
export default function ChatRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
