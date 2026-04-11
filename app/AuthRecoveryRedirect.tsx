"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const LIVE_SITE_ORIGIN = "https://thedyespace.app";

function hasRecoveryParams(search: string, hash: string) {
  const searchParams = new URLSearchParams(search);
  const hashValue = hash.startsWith("#") ? hash.slice(1) : hash;
  const hashParams = new URLSearchParams(hashValue);

  const type = searchParams.get("type") || hashParams.get("type");
  const code = searchParams.get("code") || hashParams.get("code");
  const accessToken = searchParams.get("access_token") || hashParams.get("access_token");
  const refreshToken = searchParams.get("refresh_token") || hashParams.get("refresh_token");
  const errorDescription = searchParams.get("error_description") || hashParams.get("error_description");

  return Boolean(errorDescription || type === "recovery" || code || (accessToken && refreshToken));
}

export default function AuthRecoveryRedirect() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const { pathname: currentPathname, search, hash, origin } = window.location;
    if (currentPathname === "/reset-password") {
      return;
    }

    if (!hasRecoveryParams(search, hash)) {
      return;
    }

    if (origin !== LIVE_SITE_ORIGIN) {
      window.location.replace(`${LIVE_SITE_ORIGIN}/reset-password${search}${hash}`);
      return;
    }

    window.location.replace(`/reset-password${search}${hash}`);
  }, [pathname]);

  return null;
}