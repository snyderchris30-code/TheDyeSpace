import Link from "next/link";

export default function CommunityGuidelines() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-teal-900 to-green-900 text-cyan-100 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full bg-white/10 rounded-3xl shadow-xl p-8 border border-cyan-400">
        <h1 className="text-4xl font-bold mb-6 text-cyan-200 cosmic-headline">Community Guidelines</h1>
        <ul className="space-y-4 text-lg">
          <li>✌️ Be respectful to other artists and cosmic travelers.</li>
          <li>🎨 No stealing designs or artwork. Share the love, not the copyright.</li>
          <li>🚫 No hate, harassment, or illegal sales. Keep it groovy and legal.</li>
          <li>🎶 Respect copyright on music and images. Give credit where it&apos;s due.</li>
          <li>🆘 Use the Report Abuse button if you see something uncool.</li>
        </ul>
        <div className="mt-8 flex gap-6 justify-center">
          <Link href="/terms" className="text-cyan-300 underline hover:text-green-300">Terms of Service</Link>
          <Link href="/privacy" className="text-cyan-300 underline hover:text-green-300">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}
