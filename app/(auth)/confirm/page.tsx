"use client";

import Link from "next/link";
import "./stoner-confirm.css";

export default function ConfirmPage() {
  return (
    <div className="stoner-confirm-container">
      <h1 className="stoner-confirm-title">
        Email confirmed, Welcome to The Dye Space
      </h1>
      <p className="stoner-confirm-desc">
        You are all set, take it easy and jump in when you are ready.
      </p>
      <Link href="/login">
        <button className="stoner-confirm-btn">
          Go to Login
        </button>
      </Link>
    </div>
  );
}
