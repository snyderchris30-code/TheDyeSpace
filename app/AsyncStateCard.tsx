"use client";

import type { ReactNode } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";

type AsyncStateCardProps = {
  title: string;
  message: string;
  tone?: "info" | "error";
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  icon?: ReactNode;
  className?: string;
};

export default function AsyncStateCard({
  title,
  message,
  tone = "info",
  loading = false,
  actionLabel,
  onAction,
  compact = false,
  icon,
  className = "",
}: AsyncStateCardProps) {
  const wrapperClasses = tone === "error"
    ? "border-rose-300/25 bg-rose-950/55 text-rose-100"
    : "border-cyan-300/20 bg-slate-950/55 text-cyan-100";

  const buttonClasses = tone === "error"
    ? "border-rose-300/35 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25"
    : "border-cyan-300/35 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20";

  const defaultIcon = loading
    ? <Loader2 className="h-6 w-6 animate-spin text-cyan-200" />
    : tone === "error"
      ? <AlertCircle className="h-6 w-6 text-rose-200" />
      : <Sparkles className="h-6 w-6 text-cyan-200" />;

  return (
    <div
      className={`border shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl ${wrapperClasses} ${compact ? "rounded-2xl p-5" : "rounded-[2rem] p-6 sm:p-8"} ${className}`.trim()}
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0">{icon ?? defaultIcon}</div>
        <div className="min-w-0">
          <h2 className={`font-semibold ${compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"}`}>
            {title}
          </h2>
          <p className={`mt-2 leading-6 ${compact ? "text-sm" : "text-sm sm:text-base"} ${tone === "error" ? "text-rose-100/85" : "text-cyan-100/80"}`}>
            {message}
          </p>
          {actionLabel && onAction ? (
            <button
              type="button"
              className={`mt-4 inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition ${buttonClasses}`}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}