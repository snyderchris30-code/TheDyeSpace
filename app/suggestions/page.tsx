"use client";

import { LifeBuoy, MessageSquareHeart, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import MainNavbarWrapper from "../(main)/MainNavbarWrapper";

const CASH_APP_CASHTAG = "$ShaggyDyes";

type FormState = {
  name: string;
  email: string;
  message: string;
};

const initialFormState: FormState = {
  name: "",
  email: "",
  message: "",
};

export default function SuggestionsPage() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [submitted, setSubmitted] = useState(false);
  const [submissionTime, setSubmissionTime] = useState<string | null>(null);
  const [submissionRef, setSubmissionRef] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to submit suggestion.");
      }

      setSubmitted(true);
      setSubmissionTime(new Date().toLocaleString());
      setSubmissionRef(`SUG-${Date.now().toString().slice(-6)}`);
      setForm(initialFormState);
    } catch (error: any) {
      setSubmitError(typeof error?.message === "string" ? error.message : "Failed to submit suggestion.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col text-cyan-100 min-w-full">
      <MainNavbarWrapper />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-3 pb-12 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-[radial-gradient(circle_at_top,rgba(0,255,208,0.14),transparent_36%),radial-gradient(circle_at_80%_20%,rgba(162,89,255,0.22),transparent_30%),linear-gradient(180deg,rgba(8,16,30,0.88),rgba(7,12,24,0.92))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:p-10">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
          <div className="relative max-w-3xl">
            <h1 className="glow-text text-4xl font-black leading-tight sm:text-6xl">Suggestions &amp; Support</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-cyan-100/85 sm:text-lg">
              Help us make TheDyeSpace better.
            </p>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-950/55 p-5 shadow-xl backdrop-blur-xl sm:p-7">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-200 shadow-[0_0_24px_rgba(0,255,208,0.2)]">
                <MessageSquareHeart className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-cyan-50">Suggestions Box</h2>
                <p className="text-sm text-cyan-100/70">Ideas, feedback, bugs, features, or anything on your mind.</p>
              </div>
            </div>

            {submitted ? (
              <div className="rounded-[1.5rem] border border-emerald-300/30 bg-emerald-500/10 p-5 text-emerald-100 shadow-[0_0_30px_rgba(52,211,153,0.12)]">
                <p className="text-lg font-semibold">Thanks for the signal from the stars.</p>
                <p className="mt-2 text-sm leading-6 text-emerald-100/85">
                  Your message has been received. We&apos;ll use it to keep shaping TheDyeSpace into something even better.
                </p>
                <div className="mt-4 rounded-xl border border-emerald-200/30 bg-black/20 px-4 py-3 text-xs text-emerald-100/90">
                  <p><span className="font-semibold text-emerald-50">Reference:</span> {submissionRef || "SUG-NEW"}</p>
                  <p className="mt-1"><span className="font-semibold text-emerald-50">Submitted:</span> {submissionTime || "Just now"}</p>
                </div>
                <button
                  type="button"
                  className="mt-4 inline-flex items-center rounded-full border border-emerald-200/30 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-400/10"
                  onClick={() => {
                    setSubmitted(false);
                    setSubmissionTime(null);
                    setSubmissionRef(null);
                  }}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-cyan-100">Name</span>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      className="w-full rounded-2xl border border-cyan-300/20 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan-300/45"
                      placeholder="Your name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-cyan-100">Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                      className="w-full rounded-2xl border border-cyan-300/20 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan-300/45"
                      placeholder="Your email"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-cyan-100">Message</span>
                  <textarea
                    required
                    value={form.message}
                    onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                    className="min-h-40 w-full rounded-[1.5rem] border border-cyan-300/20 bg-black/30 px-4 py-4 text-white outline-none transition focus:border-cyan-300/45"
                    placeholder="Share what would make TheDyeSpace more useful or fun."
                  />
                </label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm leading-6 text-cyan-100/65">
                    Suggestions are stored securely so your feedback can be reviewed.
                  </p>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex min-w-40 items-center justify-center rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(0,255,208,0.18)] transition hover:scale-[1.02] disabled:opacity-70"
                  >
                    {submitting ? "Sending..." : "Send Suggestion"}
                  </button>
                </div>
                {submitError ? <p className="text-sm text-rose-300">{submitError}</p> : null}
              </form>
            )}
          </section>

          <section className="rounded-[1.75rem] border border-fuchsia-300/20 bg-[linear-gradient(180deg,rgba(20,10,34,0.84),rgba(7,12,24,0.92))] p-5 shadow-xl backdrop-blur-xl sm:p-7">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-400/10 text-fuchsia-200 shadow-[0_0_24px_rgba(217,70,239,0.16)]">
                <LifeBuoy className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-cyan-50">Support the Site &amp; Help Fellow Artists</h2>
                <p className="text-sm text-cyan-100/70">Every little bit helps keep the servers running and new features coming.</p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-fuchsia-300/25 bg-black/30 p-5 text-sm leading-7 text-cyan-100/85">
              <p className="font-semibold text-cyan-50">Verified Seller Badge</p>
              <p className="mt-2">
                For real tie-dye artists and hippie vendors.<br />
                Get the <span className="font-semibold text-cyan-50">Verified Seller</span> badge after manual review.
              </p>
              <ul className="mt-4 space-y-1">
                <li><span className="font-semibold text-cyan-50">$15 per month</span></li>
                <li><span className="font-semibold text-cyan-50">$120 per year</span> (save $60)</li>
              </ul>
              <p className="mt-4"><span className="font-semibold text-cyan-50">How to apply:</span> Go to your profile → &quot;Apply for Verified Seller&quot;</p>
              <p className="mt-4 font-semibold text-cyan-50">Current Support via Cash App:</p>
              <a
                href={`https://cash.app/${CASH_APP_CASHTAG.replace("$", "")}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-cyan-200 underline decoration-cyan-400/50 underline-offset-4 transition hover:text-cyan-50"
              >
                {CASH_APP_CASHTAG}
              </a>
              <p className="mt-4">
                This site is currently a one-man project with help from Grok. Every donation and Verified Seller badge directly helps keep TheDyeSpace alive and growing.
              </p>
              <p className="mt-4">Thank you for being part of the community ❤️</p>
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-cyan-300/15 bg-slate-950/55 p-5 text-sm leading-7 text-cyan-100/75">
              <p>
                Want to support in other ways?<br/>
                Share the site with friends, invite fellow artists, and keep the feedback coming.
              </p>
              <Link href="/explore" className="mt-4 inline-flex items-center text-cyan-200 underline decoration-cyan-400/50 underline-offset-4 transition hover:text-cyan-50">
                Explore the community feed
              </Link>
            </div>
          </section>
        </div>

        <footer className="flex flex-col items-center justify-between gap-3 border-t border-cyan-300/15 pt-6 text-sm text-cyan-100/70 sm:flex-row">
          <p>Built with tie-dye love, good vibes, and community feedback.</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/terms" className="underline decoration-cyan-400/40 underline-offset-4 hover:text-cyan-50">Terms</Link>
            <Link href="/privacy" className="underline decoration-cyan-400/40 underline-offset-4 hover:text-cyan-50">Privacy</Link>
            <Link href="/guidelines" className="underline decoration-cyan-400/40 underline-offset-4 hover:text-cyan-50">Guidelines</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}