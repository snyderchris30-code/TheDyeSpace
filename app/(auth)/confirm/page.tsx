"use client";

import Link from "next/link";
import { useEffect } from "react";
import "./stoner-confirm.css";

const LIVE_SITE_ORIGIN = "https://thedyespace.app";

export default function ConfirmPage() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.origin !== LIVE_SITE_ORIGIN) {
      window.location.replace(`${LIVE_SITE_ORIGIN}/confirm${window.location.search}${window.location.hash}`);
    }
  }, []);

  return (
    <div className="stoner-confirm-container">
      <h1 className="stoner-confirm-title">
        Email confirmed, Welcome to The Dye Space
      </h1>
      <p className="stoner-confirm-desc">
        You are all set, take it easy and jump in when you are ready.
      </p>
      <Link href="https://thedyespace.app/login">
        <button className="stoner-confirm-btn">
          Go to Login
        </button>
      </Link>
    </div>
  );
}
