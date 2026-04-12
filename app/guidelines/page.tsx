export default function CommunityGuidelines() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-teal-900 to-green-900 text-cyan-100 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full bg-white/10 rounded-3xl shadow-xl p-8 border border-cyan-400 prose prose-invert prose-cyan">
        <h1 className="text-4xl font-bold mb-6 text-cyan-200 cosmic-headline">Community Guidelines</h1>
        <article className="prose prose-invert prose-cyan">
          <h3>Community Guidelines</h3>
          <p>Welcome to TheDyeSpace. We’re building a positive, creative, and respectful community for tie-dye artists and enthusiasts.</p>
          <p>By using this platform, you agree to follow these rules. We take them seriously to keep the space safe and fun for everyone.</p>
          <h4>Core Rules</h4>
          <ul>
            <li>Be respectful to other members. No hate speech, harassment, threats, or personal attacks.</li>
            <li>Do not steal or repost someone else’s artwork, designs, photos, or content without permission.</li>
            <li>You must be 18 years or older and located in the United States to use this platform.</li>
            <li>Keep all content appropriate. No pornography, nudity, sexually explicit material, or graphic violence.</li>
            <li>Posting artistic or educational photos of plants and mushrooms is allowed, but any promotion or sale of illegal substances (including anything disguised as tie-dye) is strictly prohibited.</li>
            <li>Respect copyright. Do not upload music, images, or other copyrighted material you do not have the rights to use.</li>
            <li>Be honest when selling. No fake products, misleading descriptions, or scams.</li>
          </ul>
          <h4>Additional Important Rules</h4>
          <ul>
            <li>It is not cool to wash your feet in the drinking water. Keep the vibe clean and respectful for everyone.</li>
            <li>No spam, excessive self-promotion, or flooding the platform with the same content.</li>
            <li>No impersonation of other artists or members.</li>
            <li>No doxxing or sharing private personal information without consent.</li>
          </ul>
          <h4>Selling on TheDyeSpace</h4>
          <p>If you sell tie-dye clothing or related items:</p>
          <ul>
            <li>You are responsible for all transactions, shipping, quality, and customer service.</li>
            <li>TheDyeSpace is not a party to any sale and is not responsible for disputes between buyers and sellers.</li>
            <li>We may remove listings or ban sellers who repeatedly receive valid complaints.</li>
          </ul>
          <h4>Enforcement</h4>
          <p>We review reported content and reserve the right to:</p>
          <ul>
            <li>Remove any post, comment, or profile</li>
            <li>Issue warnings</li>
            <li>Temporarily mute or shadow ban accounts</li>
            <li>Permanently ban accounts</li>
          </ul>
          <p>Repeated or serious violations may result in an immediate ban.</p>
          <h4>Liability Disclaimer</h4>
          <p>TheDyeSpace is a platform for users to share and connect. We do not endorse, guarantee, or take responsibility for any user-generated content, sales, or interactions. Use the platform at your own risk.</p>
          <p>By using TheDyeSpace you agree that we are not liable for any damages, losses, or disputes that arise from your use of the site.</p>
          <h4>Changes to These Guidelines</h4>
          <p>We may update these guidelines from time to time. Continued use of the platform after changes means you accept the new rules.</p>
        </article>
        <div className="mt-8 flex gap-6 justify-center">
          <a href="/terms" className="text-cyan-300 underline hover:text-green-300">Terms of Service</a>
          <a href="/privacy" className="text-cyan-300 underline hover:text-green-300">Privacy Policy</a>
        </div>
      </div>
    </div>
  );
}
