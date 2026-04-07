"use client";

import { ADMIN_ACTION_MENU_ITEMS, type AdminActionName } from "@/lib/admin-actions";

type AdminActionMenuProps = {
  targetUserId: string;
  onAction: (targetUserId: string, action: AdminActionName, durationHours?: number) => Promise<void> | void;
  label?: string;
  align?: "left" | "right";
  className?: string;
};

const TONE_CLASS_NAMES: Record<string, string> = {
  pink: "border-fuchsia-300/30 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/15",
  cyan: "border-cyan-300/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15",
  emerald: "border-emerald-300/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15",
  rose: "border-rose-300/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15",
  teal: "border-teal-300/30 bg-teal-500/10 text-teal-100 hover:bg-teal-500/15",
  amber: "border-amber-300/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15",
  slate: "border-slate-300/30 bg-slate-500/10 text-slate-100 hover:bg-slate-500/15",
};

export default function AdminActionMenu({
  targetUserId,
  onAction,
  label = "Admin",
  align = "right",
  className = "",
}: AdminActionMenuProps) {
  const menuAlignment = align === "left" ? "left-0" : "right-0";

  return (
    <details className={`relative ${className}`.trim()}>
      <summary className="inline-flex cursor-pointer items-center rounded-full border border-violet-300/25 bg-black/20 px-3 py-1 text-xs font-semibold text-violet-200 transition hover:bg-violet-900/30">
        {label}
      </summary>
      <div className={`absolute ${menuAlignment} z-[2147483650] mt-2 w-72 rounded-2xl border border-violet-300/20 bg-slate-950/95 p-3 shadow-[0_20px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl`}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-violet-300/80">Admin Actions</p>
        <div className="grid gap-2">
          {ADMIN_ACTION_MENU_ITEMS.map((item) => (
            <button
              key={`${item.action}-${item.durationHours ?? "base"}`}
              type="button"
              className={`w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${TONE_CLASS_NAMES[item.tone]}`}
              onClick={(event) => {
                const details = event.currentTarget.closest("details") as HTMLDetailsElement | null;
                const result = onAction(targetUserId, item.action, item.durationHours);
                details?.removeAttribute("open");
                void Promise.resolve(result);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}