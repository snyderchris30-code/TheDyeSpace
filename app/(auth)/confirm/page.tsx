import Link from "next/link";

export default function ConfirmPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "1.5rem", color: "#4ade80", textShadow: "0 0 8px #22d3ee" }}>
        Email confirmed, dude! ✅
      </h1>
      <p style={{ fontSize: "1.2rem", marginBottom: "2.5rem", color: "#a3e635" }}>
        You can now log in.
      </p>
      <Link href="/login">
        <button style={{ padding: "1rem 2.5rem", fontSize: "1.3rem", background: "#22d3ee", color: "#fff", border: "none", borderRadius: "1.5rem", boxShadow: "0 2px 16px #0ea5e9", cursor: "pointer", fontWeight: "bold", letterSpacing: "0.05em" }}>
          Go to Login
        </button>
      </Link>
    </div>
  );
}
