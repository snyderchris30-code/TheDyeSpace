import Link from "next/link";
import "./stoner-confirm.css";

export default function ConfirmPage() {
  return (
    <div className="stoner-confirm-container">
      <h1 className="stoner-confirm-title">
        Email confirmed, dude! ✅
      </h1>
      <p className="stoner-confirm-desc">
        You can now log in.
      </p>
      <Link href="/login">
        <button className="stoner-confirm-btn">
          Go to Login
        </button>
      </Link>
    </div>
  );
}
