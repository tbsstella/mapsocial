"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Settings now lives in a right-side card on the map; keep the route as a redirect. */
export default function SettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
