import NavBar from "@/components/NavBar";

export const metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for MY Chess Tour — how we collect, use, and protect your personal data under the PDPA Malaysia.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="card card--featured p-8">
          <div className="text-center mb-8">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Privacy Policy</h1>
            <p className="auth-subheading">Effective Date: 1 June 2025</p>
            <hr className="divider-gold" />
          </div>

          <div className="font-lato text-sm text-text-body leading-relaxed space-y-6">
            <p className="text-text-secondary">
              MY Chess Tour (&quot;MCT&quot;, &quot;we&quot;, &quot;us&quot;,
              or &quot;our&quot;) is committed to protecting your personal data
              in accordance with the{" "}
              <strong>Personal Data Protection Act 2010 (PDPA)</strong> of
              Malaysia. This Privacy Policy explains what data we collect, how
              we use it, and your rights.
            </p>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                1. Data We Collect
              </h2>
              <p className="text-text-secondary mb-2 font-semibold">
                Account Data
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary mb-4">
                <li>First name, last name</li>
                <li>Email address</li>
                <li>Profile avatar</li>
              </ul>

              <p className="text-text-secondary mb-2 font-semibold">
                Player Profile Data
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary mb-4">
                <li>Nationality</li>
                <li>FIDE ID and MCF ID</li>
                <li>
                  Date of birth, gender — collected for age-category eligibility
                  and FIDE registration
                </li>
                <li>
                  OKU (disability) status — collected solely to facilitate
                  accessibility requirements at events
                </li>
              </ul>

              <p className="text-text-secondary mb-2 font-semibold">
                Financial Data (collected only for prize payout purposes)
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary mb-4">
                <li>Bank account number</li>
                <li>Bank account holder name</li>
                <li>Bank name</li>
              </ul>

              <p className="text-text-secondary mb-2 font-semibold">
                Tournament &amp; Registration Data
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>Tournament registration records</li>
                <li>Payment records (amounts, dates, transaction IDs)</li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                2. Sensitive Personal Data
              </h2>
              <p className="text-text-secondary mb-3">
                Under the PDPA, certain data requires your explicit consent
                before collection:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="font-cinzel tracking-widest uppercase text-gold-muted text-left px-3 py-2 border-b border-border">
                        Data Field
                      </th>
                      <th className="font-cinzel tracking-widest uppercase text-gold-muted text-left px-3 py-2 border-b border-border">
                        Reason for Collection
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        OKU (disability) status
                      </td>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        Event accessibility and FIDE Special Needs registration
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        Date of birth
                      </td>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        Age-category eligibility; identity verification
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-text-secondary">Gender</td>
                      <td className="px-3 py-2 text-text-secondary">
                        Gender-restricted event categories (e.g. Women&apos;s Open)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-text-secondary mt-3">
                By providing this data, you give explicit consent for its use as
                described above.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                3. How We Use Your Data
              </h2>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary mb-2">
                <li>To create and manage your MCT account.</li>
                <li>
                  To register you for tournaments and verify eligibility.
                </li>
                <li>To submit ratings to FIDE and MCF on your behalf.</li>
                <li>To process prize payouts via bank transfer.</li>
                <li>
                  To send you tournament updates, results, and important
                  notifications.
                </li>
                <li>
                  To comply with legal obligations under Malaysian law.
                </li>
              </ul>
              <p className="text-text-secondary">
                We do not sell, rent, or trade your personal data to third
                parties for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                4. Data Retention
              </h2>
              <p className="text-text-secondary mb-3">
                We retain your data only as long as necessary:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="font-cinzel tracking-widest uppercase text-gold-muted text-left px-3 py-2 border-b border-border">
                        Data Type
                      </th>
                      <th className="font-cinzel tracking-widest uppercase text-gold-muted text-left px-3 py-2 border-b border-border">
                        Retention Period
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        Personal profile data
                      </td>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        30 days after account deletion request
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        Financial / payment records
                      </td>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        7 years from transaction date (Income Tax Act requirement)
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        Tournament results &amp; pairings
                      </td>
                      <td className="px-3 py-2 border-b border-border text-text-secondary">
                        Kept indefinitely (not personal data)
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-text-secondary">
                        Registration records
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        Personal fields anonymised after account deletion;
                        financial facts retained for 7 years
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                5. Data Security
              </h2>
              <p className="text-text-secondary mb-2">
                We implement appropriate technical and organisational measures
                to protect your data:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>
                  Sensitive personal data (OKU status, date of birth, gender)
                  and financial data (bank details) are encrypted at rest.
                </li>
                <li>
                  All data is transmitted over encrypted connections
                  (HTTPS/TLS).
                </li>
                <li>
                  Access to personal data is restricted to authorised personnel
                  only.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                6. Your Rights Under PDPA
              </h2>
              <p className="text-text-secondary mb-2">
                As a data subject under the PDPA, you have the right to:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary mb-2">
                <li>
                  <strong>Access</strong> — request a copy of the personal data
                  we hold about you.
                </li>
                <li>
                  <strong>Correction</strong> — request correction of inaccurate
                  or incomplete data.
                </li>
                <li>
                  <strong>Withdrawal of consent</strong> — withdraw consent for
                  the processing of sensitive personal data at any time (note:
                  this may affect your ability to participate in certain events).
                </li>
                <li>
                  <strong>Data deletion</strong> — request deletion of your
                  account and associated personal data, subject to our retention
                  obligations.
                </li>
              </ul>
              <p className="text-text-secondary">
                To exercise any of these rights, contact us at{" "}
                <strong>privacy@mychesstour.com</strong>.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                7. Sharing of Data
              </h2>
              <p className="text-text-secondary mb-2">
                We may share your data with the following third parties only
                where necessary:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>
                  <strong>FIDE</strong> — for rating submission and player
                  registration.
                </li>
                <li>
                  <strong>Malaysian Chess Federation (MCF)</strong> — for
                  MCF-rated event registration.
                </li>
                <li>
                  <strong>Tournament organisers</strong> — name, FIDE/MCF ID,
                  and rating for pairing and certification purposes.
                </li>
                <li>
                  <strong>Payment processors</strong> — for processing entry
                  fees and prize disbursements.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                8. Cookies
              </h2>
              <p className="text-text-secondary">
                We use session cookies essential for authentication and platform
                functionality. We do not use advertising or tracking cookies.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                9. Changes to This Policy
              </h2>
              <p className="text-text-secondary">
                We may update this Privacy Policy from time to time. We will
                notify you of significant changes via email or a platform notice
                at least 14 days before they take effect.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                10. Contact Us
              </h2>
              <p className="text-text-secondary">
                For privacy-related inquiries or to exercise your PDPA rights,
                contact our Data Protection Officer at{" "}
                <strong>privacy@mychesstour.com</strong>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
