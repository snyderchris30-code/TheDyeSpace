import Link from "next/link";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-teal-900 to-green-900 text-cyan-100 flex flex-col items-center justify-start pt-24 pb-8 px-8">
      <div className="max-w-4xl w-full bg-white/10 rounded-3xl shadow-xl p-8 border border-cyan-400">
        <h1 className="text-4xl font-bold mb-3 text-cyan-200">Terms of Service</h1>
        <p className="text-sm text-cyan-200/80 mb-8">Effective date: April 3, 2026</p>

        <div className="space-y-6 text-base leading-7 text-cyan-50/95">
          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">1. Eligibility</h2>
            <p>
              TheDyeSpace is available only to residents of the United States who are at least 18 years old.
              By using this service, you represent and warrant that you meet both requirements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">2. Your Content and License Grant</h2>
            <p>
              You retain ownership of the content you submit, including posts, profiles, images, comments,
              and other materials. By posting or submitting content, you grant TheDyeSpace a worldwide,
              non-exclusive, royalty-free license to host, store, reproduce, display, distribute, and promote
              that content in connection with operating, improving, and marketing the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">3. Prohibited Conduct</h2>
            <p className="mb-2">You may not use the service to:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Infringe copyrights, trademarks, or other intellectual property rights, or use content without permission.</li>
              <li>Sell or promote counterfeit, illegal, or otherwise prohibited items.</li>
              <li>Post or engage in hate speech, harassment, threats, discrimination, or illegal activities.</li>
              <li>Distribute spam, scams, misleading information, malware, or other malicious content.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">4. Content Moderation and Account Enforcement</h2>
            <p>
              We reserve the right, at our sole discretion, to remove any content, suspend accounts,
              or permanently ban users at any time and without prior notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">5. Disclaimer of Warranties</h2>
            <p>
              The service is provided on an &quot;as is&quot; and &quot;as available&quot; basis, without warranties of any kind,
              express or implied, including warranties of merchantability, fitness for a particular purpose,
              non-infringement, availability, accuracy, or reliability.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">6. User-Generated Content</h2>
            <p>
              TheDyeSpace is not responsible or liable for user-generated content, including posts, comments,
              profile information, listings, messages, or third-party links shared through the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">7. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, TheDyeSpace and its operators, owners, affiliates,
              employees, and agents will not be liable for any indirect, incidental, special, consequential,
              exemplary, or punitive damages, or for any loss of profits, data, goodwill, or business,
              arising out of or related to your use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">8. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the State of Washington, United States, without regard
              to conflict of laws principles.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">9. Changes to These Terms</h2>
            <p>
              We may update these Terms at any time. Continued use of the service after changes become effective
              constitutes acceptance of the updated Terms.
            </p>
          </section>
          {/* Legal Protections and Disclaimers */}
          <section className="mt-10">
            <h2 className="text-xl font-semibold text-cyan-100 mb-2">Important Protections</h2>
            <ul className="list-disc space-y-2 pl-6">
              <li><strong>Age and Location:</strong> TheDyeSpace is for users 18 years and older located in the United States only.</li>
              <li><strong>Prohibited Activity:</strong> No illegal substances or activities are allowed. This includes selling, promoting, or discussing drugs (even if referred to as &apos;special dyes&apos;, &apos;herbal extracts&apos;, or similar). Any such content will result in immediate removal and possible permanent ban.</li>
              <li><strong>Verified Seller Badge:</strong> The Verified Seller badge is manually reviewed by site admins. It indicates that we have reviewed the seller&apos;s business, but TheDyeSpace does not guarantee the quality, safety, or delivery of any products sold by Verified Sellers. Buyers assume all risk.</li>
              <li><strong>Affiliate Links:</strong> Some links on the site may be affiliate links. TheDyeSpace may earn a small commission if you make a purchase through them, at no extra cost to you.</li>
              <li>We reserve the right to remove any content and ban any user at any time for any reason.</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 flex gap-6 justify-center">
          <Link href="/privacy" className="text-cyan-300 underline hover:text-green-300">Privacy Policy</Link>
          <Link href="/guidelines" className="text-cyan-300 underline hover:text-green-300">Community Guidelines</Link>
        </div>
      </div>
    </div>
  );
}
