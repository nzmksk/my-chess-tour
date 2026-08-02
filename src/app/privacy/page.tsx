import NavBar from "@/components/NavBar";
import { TERMS_VERSION, formatLegalVersion } from "@/lib/legal";

export const metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for MY Chess Tour — how we collect, use, and protect your personal data under the PDPA Malaysia.",
};

export default function PrivacyPage() {
  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="card card--featured p-8">
          <div className="mb-8 text-center">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Privacy Policy</h1>
            <p className="auth-subheading">
              Effective Date: {formatLegalVersion(TERMS_VERSION)}
            </p>
            <hr className="divider-gold" />
          </div>

          <div className="font-lato text-text-body space-y-6 text-sm leading-relaxed">
            <p className="text-text-secondary">
              MY Chess Tour (&quot;MCT&quot;, &quot;we&quot;, &quot;us&quot;, or
              &quot;our&quot;) is committed to protecting your personal data in
              accordance with the{" "}
              <strong>Personal Data Protection Act 2010 (PDPA)</strong> of
              Malaysia. This Privacy Policy explains what data we collect, how
              we use it, and your rights.
            </p>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                1. Data We Collect
              </h2>
              <p className="text-text-secondary mb-2 font-semibold">
                Account Data
              </p>
              <ul className="text-text-secondary mb-4 list-disc space-y-1 pl-5">
                <li>First name, last name</li>
                <li>Email address</li>
                <li>Profile avatar</li>
              </ul>

              <p className="text-text-secondary mb-2 font-semibold">
                Player Profile Data
              </p>
              <ul className="text-text-secondary mb-4 list-disc space-y-1 pl-5">
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
              <ul className="text-text-secondary mb-4 list-disc space-y-1 pl-5">
                <li>Bank account number</li>
                <li>Bank account holder name</li>
                <li>Bank name</li>
              </ul>

              <p className="text-text-secondary mb-2 font-semibold">
                Business Verification Data (organisers only)
              </p>
              <ul className="text-text-secondary mb-4 list-disc space-y-1 pl-5">
                <li>
                  SSM or ROS registration documents, and supporting evidence of
                  the organisation&apos;s standing
                </li>
                <li>Registered business address and contact details</li>
                <li>
                  Name and role of the authorised representative accepting the
                  Organizer Agreement
                </li>
                <li>Bank account details used to receive tournament payouts</li>
              </ul>

              <p className="text-text-secondary mb-2 font-semibold">
                Tournament &amp; Registration Data
              </p>
              <ul className="text-text-secondary list-disc space-y-1 pl-5">
                <li>Tournament registration records</li>
                <li>Payment records (amounts, dates, transaction IDs)</li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
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
                      <th className="font-cinzel text-gold-muted border-border border-b px-3 py-2 text-left tracking-widest uppercase">
                        Data Field
                      </th>
                      <th className="font-cinzel text-gold-muted border-border border-b px-3 py-2 text-left tracking-widest uppercase">
                        Reason for Collection
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        OKU (disability) status
                      </td>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Event accessibility and FIDE Special Needs registration
                      </td>
                    </tr>
                    <tr>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Date of birth
                      </td>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Age-category eligibility; identity verification
                      </td>
                    </tr>
                    <tr>
                      <td className="text-text-secondary px-3 py-2">Gender</td>
                      <td className="text-text-secondary px-3 py-2">
                        Gender-restricted event categories (e.g. Women&apos;s
                        Open)
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
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                3. How We Use Your Data
              </h2>
              <ul className="text-text-secondary mb-2 list-disc space-y-1 pl-5">
                <li>To create and manage your MCT account.</li>
                <li>To register you for tournaments and verify eligibility.</li>
                <li>To submit ratings to FIDE and MCF on your behalf.</li>
                <li>To process prize payouts via bank transfer.</li>
                <li>
                  To send you tournament updates, results, and important
                  notifications.
                </li>
                <li>To comply with legal obligations under Malaysian law.</li>
              </ul>
              <p className="text-text-secondary">
                We do not sell, rent, or trade your personal data to third
                parties for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                4. Data Retention
              </h2>
              <p className="text-text-secondary mb-3">
                We retain your data only as long as necessary:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="font-cinzel text-gold-muted border-border border-b px-3 py-2 text-left tracking-widest uppercase">
                        Data Type
                      </th>
                      <th className="font-cinzel text-gold-muted border-border border-b px-3 py-2 text-left tracking-widest uppercase">
                        Retention Period
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Personal profile data
                      </td>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        30 days after account deletion request
                      </td>
                    </tr>
                    <tr>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Financial / payment records
                      </td>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        7 years from transaction date (Income Tax Act
                        requirement)
                      </td>
                    </tr>
                    <tr>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Tournament results &amp; pairings
                      </td>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Kept indefinitely (not personal data)
                      </td>
                    </tr>
                    <tr>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Registration records
                      </td>
                      <td className="border-border text-text-secondary border-b px-3 py-2">
                        Personal fields anonymised after account deletion;
                        financial facts retained for 7 years
                      </td>
                    </tr>
                    <tr>
                      <td className="text-text-secondary px-3 py-2">
                        Business verification documents (organisers)
                      </td>
                      <td className="text-text-secondary px-3 py-2">
                        7 years after the organiser relationship ends
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                5. Data Security
              </h2>
              <p className="text-text-secondary mb-2">
                We implement appropriate technical and organisational measures
                to protect your data:
              </p>
              <ul className="text-text-secondary list-disc space-y-1 pl-5">
                <li>
                  All data is transmitted over encrypted connections
                  (HTTPS/TLS).
                </li>
                <li>
                  Our database and file storage are hosted on encrypted storage
                  volumes. We do not additionally encrypt individual fields such
                  as bank account numbers, and we would rather state that
                  plainly than overstate the protection.
                </li>
                <li>
                  Access is enforced at the database level by row-level
                  security, so one user&apos;s records are not readable by
                  another.
                </li>
                <li>
                  Sensitive personal data (OKU status, date of birth, gender)
                  and financial data (bank details) are restricted to the
                  specific features that need them, and to authorised personnel.
                </li>
                <li>
                  Bank account numbers and document paths are masked in our
                  internal change logs, so historical copies of them are not
                  retained there.
                </li>
                <li>
                  Verification documents are held in private storage that is not
                  publicly reachable, and are reviewed only by platform
                  administrators.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                6. Your Rights Under PDPA
              </h2>
              <p className="text-text-secondary mb-2">
                As a data subject under the PDPA, you have the right to:
              </p>
              <ul className="text-text-secondary mb-2 list-disc space-y-1 pl-5">
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
                  this may affect your ability to participate in certain
                  events).
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
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                7. Sharing of Data
              </h2>
              <p className="text-text-secondary mb-2">
                We may share your data with the following third parties only
                where necessary:
              </p>
              <ul className="text-text-secondary list-disc space-y-1 pl-5">
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
                  <strong>CHIP (chip-in.asia)</strong> — our licensed payment
                  processor, which receives the details needed to collect entry
                  fees and to disburse organiser payouts and prizes, including
                  bank account details.
                </li>
              </ul>
              <p className="text-text-secondary mt-2">
                Business verification documents are not shared with third
                parties. They are reviewed by platform administrators and
                disclosed further only where the law requires it.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                8. Cookies
              </h2>
              <p className="text-text-secondary">
                We use session cookies essential for authentication and platform
                functionality. We do not use advertising or tracking cookies.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                9. Changes to This Policy
              </h2>
              <p className="text-text-secondary">
                We may update this Privacy Policy from time to time. We will
                notify you of significant changes via email or a platform notice
                at least 14 days before they take effect.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
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
