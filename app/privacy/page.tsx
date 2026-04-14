import Link from "next/link";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-teal-900 to-green-900 text-cyan-100 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full bg-white/10 rounded-3xl shadow-xl p-8 border border-cyan-400">
        <h1 className="text-4xl font-bold mb-6 text-cyan-200 cosmic-headline">Privacy Policy</h1>
        <ul className="space-y-4 text-lg">
          <li>📧 We collect your email, username, profile data, and posts to operate the platform.</li>
          <li>🗄️ We use Supabase to store your data safely in the cloud.</li>
          <li>🚫 We never sell your data. Your information stays yours.</li>
          <li>🗑️ You can delete your account anytime and vanish into the stars.</li>
          <li>🍪 We use basic cookies to keep you logged in and grooving. No tracking for profit.</li>
        </ul>
        <div className="mt-8 flex gap-6 justify-center">
          <Link href="/terms" className="text-cyan-300 underline hover:text-green-300">Terms of Service</Link>
          <Link href="/guidelines" className="text-cyan-300 underline hover:text-green-300">Community Guidelines</Link>
        </div>
          <div className="mt-10">
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">Additional Privacy Protections</h2>
            <ul className="list-disc space-y-2 pl-6 text-base">
              <li>We collect basic account information (email, username, profile data) to operate the site.</li>
              <li>We do not sell your personal data.</li>
              <li>Private chats are only visible to participants in that chat.</li>
              <li>Reported content may be reviewed by admins for safety.</li>
            </ul>
          </div>
      </div>
    </div>
  );
}
