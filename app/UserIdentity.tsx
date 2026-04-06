import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";
import { formatMemberNumber } from "@/lib/member-number";

type UserIdentityProps = {
  displayName?: string | null;
  username?: string | null;
  verifiedBadge?: boolean | null;
  memberNumber?: number | null;
  href?: string | null;
  timestampText?: string | null;
  className?: string;
  nameClassName?: string;
  usernameClassName?: string;
  metaClassName?: string;
};

function IdentityLink({
  href,
  className,
  children,
}: {
  href?: string | null;
  className: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className={className} prefetch={false}>
        {children}
      </Link>
    );
  }

  return <span className={className}>{children}</span>;
}

export default function UserIdentity({
  displayName,
  username,
  verifiedBadge,
  memberNumber,
  href,
  timestampText,
  className = "",
  nameClassName = "font-semibold text-[color:var(--post-text)]",
  usernameClassName = "text-xs text-[color:var(--post-highlight)]/80",
  metaClassName = "text-xs text-[color:var(--post-text)]/55",
}: UserIdentityProps) {
  const safeDisplayName = displayName || username || "DyeSpace User";
  const safeHref = href ?? (username ? `/profile/${encodeURIComponent(username)}` : null);
  const formattedMemberNumber = formatMemberNumber(memberNumber);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <IdentityLink href={safeHref} className={nameClassName}>
          {safeDisplayName}
        </IdentityLink>
        {verifiedBadge ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
            <BadgeCheck className="h-3.5 w-3.5" />
            Verified
          </span>
        ) : null}
        {formattedMemberNumber ? (
          <span className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
            {formattedMemberNumber}
          </span>
        ) : null}
        {timestampText ? <span className={metaClassName}>{timestampText}</span> : null}
      </div>
      {username ? (
        <IdentityLink href={safeHref} className={usernameClassName}>
          @{username}
        </IdentityLink>
      ) : null}
    </div>
  );
}