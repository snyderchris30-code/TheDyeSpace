import Link from "next/link";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-teal-900 to-green-900 text-cyan-100 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full bg-white/10 rounded-3xl shadow-xl p-8 border border-cyan-400">
        <h1 className="text-4xl font-bold mb-6 text-cyan-200 cosmic-headline">Terms of Service</h1>
        <ul className="space-y-4 text-lg">
          <li>🌈 You own your content, but you give TheDyeSpace a license to display it on the site.</li>
          <li>🌌 We are not responsible for what users post. Please vibe responsibly.</li>
          <li>🚫 No illegal activity, no hate speech, and no stealing other artists&apos; designs.</li>
          <li>🛒 &quot;For sale&quot; items must be legal tie-dye only. No funny business.</li>
          <li>🌀 We can remove content or ban users if needed to keep the peace.</li>
          <li>🔮 These terms may change as the universe evolves. Check back for updates.</li>
        </ul>
        <div className="mt-8 flex gap-6 justify-center">
          <Link href="/privacy" className="text-cyan-300 underline hover:text-green-300">Privacy Policy</Link>
          <Link href="/guidelines" className="text-cyan-300 underline hover:text-green-300">Community Guidelines</Link>
        </div>
      </div>
    </div>
  );
}
