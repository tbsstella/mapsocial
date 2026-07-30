"use client";

import { useRouter } from "next/navigation";
import { ProfileForm } from "@/components/ProfileForm";
import { useMe } from "@/hooks/useMe";
import { useI18n } from "@/lib/i18n";

export default function OnboardingPage() {
  const { me, isLoading, invalidate } = useMe();
  const { t } = useI18n();
  const router = useRouter();

  if (isLoading)
    return <div className="p-8 text-sm text-slate-400">{t("common.loading")}</div>;
  if (!me?.user) {
    router.replace("/");
    return null;
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      {/* iOS large-title header */}
      <h1 className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-[32px] font-bold tracking-tight text-transparent">
        {t("onboard.title")}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
        {t("onboard.subtitle")}
        {me.user.trustScore > 0 && t("onboard.initScore", { n: me.user.trustScore })}
        {""}
      </p>
      <div className="glass-strong sheet-up mt-6 rounded-[28px] p-6">
        <ProfileForm
          me={me}
          submitLabel={t("onboard.submit")}
          onSaved={() => {
            invalidate();
            router.push("/");
          }}
        />
      </div>
    </div>
  );
}
