"use client";

import { useEffect } from "react";

interface PrivacyModalProps {
  onClose: () => void;
}

export default function PrivacyModal({ onClose }: PrivacyModalProps) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--featured">
        <div className="modal-header">
          <h2 id="privacy-modal-title" className="modal-title">
            Privacy Policy
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close Privacy Policy"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-paragraph">
            <strong>Effective Date: 1 June 2025</strong>
          </p>
          <p className="modal-paragraph">
            MY Chess Tour (&quot;MCT&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) is committed to protecting your personal data in
            accordance with the{" "}
            <strong>Personal Data Protection Act 2010 (PDPA)</strong> of
            Malaysia. This Privacy Policy explains what data we collect, how we
            use it, and your rights.
          </p>

          <h3 className="modal-section-title">1. Data We Collect</h3>
          <p className="modal-paragraph">
            We collect the following categories of personal data:
          </p>

          <p className="modal-paragraph">
            <strong>Account Data</strong>
          </p>
          <ul className="modal-list">
            <li>First name, last name</li>
            <li>Email address</li>
            <li>Profile avatar</li>
          </ul>

          <p className="modal-paragraph">
            <strong>Player Profile Data</strong>
          </p>
          <ul className="modal-list">
            <li>Nationality</li>
            <li>FIDE ID and MCF ID</li>
            <li>
              Date of birth, gender — collected for age-category eligibility and
              FIDE registration
            </li>
            <li>
              OKU (disability) status — collected solely to facilitate
              accessibility requirements at events
            </li>
          </ul>

          <p className="modal-paragraph">
            <strong>Financial Data</strong> (collected only for prize payout
            purposes)
          </p>
          <ul className="modal-list">
            <li>Bank account number</li>
            <li>Bank account holder name</li>
            <li>Bank name</li>
          </ul>

          <p className="modal-paragraph">
            <strong>Tournament & Registration Data</strong>
          </p>
          <ul className="modal-list">
            <li>Tournament registration records</li>
            <li>Payment records (amounts, dates, transaction IDs)</li>
          </ul>

          <h3 className="modal-section-title">2. Sensitive Personal Data</h3>
          <p className="modal-paragraph">
            Under the PDPA, certain data requires your explicit consent before
            collection:
          </p>
          <table className="modal-table">
            <thead>
              <tr>
                <th>Data Field</th>
                <th>Reason for Collection</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>OKU (disability) status</td>
                <td>Event accessibility and FIDE Special Needs registration</td>
              </tr>
              <tr>
                <td>Date of birth</td>
                <td>Age-category eligibility; identity verification</td>
              </tr>
              <tr>
                <td>Gender</td>
                <td>
                  Gender-restricted event categories (e.g. Women&apos;s Open)
                </td>
              </tr>
            </tbody>
          </table>
          <p className="modal-paragraph">
            By providing this data, you give explicit consent for its use as
            described above.
          </p>

          <h3 className="modal-section-title">3. How We Use Your Data</h3>
          <ul className="modal-list">
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
          <p className="modal-paragraph">
            We do not sell, rent, or trade your personal data to third parties
            for marketing purposes.
          </p>

          <h3 className="modal-section-title">4. Data Retention</h3>
          <p className="modal-paragraph">
            We retain your data only as long as necessary:
          </p>
          <table className="modal-table">
            <thead>
              <tr>
                <th>Data Type</th>
                <th>Retention Period</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Personal profile data</td>
                <td>30 days after account deletion request</td>
              </tr>
              <tr>
                <td>Financial / payment records</td>
                <td>
                  7 years from transaction date (Income Tax Act requirement)
                </td>
              </tr>
              <tr>
                <td>Tournament results &amp; pairings</td>
                <td>Kept indefinitely (not personal data)</td>
              </tr>
              <tr>
                <td>Registration records</td>
                <td>
                  Personal fields anonymised after account deletion; financial
                  facts retained for 7 years
                </td>
              </tr>
            </tbody>
          </table>

          <h3 className="modal-section-title">5. Data Security</h3>
          <p className="modal-paragraph">
            We implement appropriate technical and organisational measures to
            protect your data:
          </p>
          <ul className="modal-list">
            <li>
              Sensitive personal data (OKU status, date of birth, gender) and
              financial data (bank details) are encrypted at rest.
            </li>
            <li>
              All data is transmitted over encrypted connections (HTTPS/TLS).
            </li>
            <li>
              Access to personal data is restricted to authorised personnel
              only.
            </li>
          </ul>

          <h3 className="modal-section-title">6. Your Rights Under PDPA</h3>
          <p className="modal-paragraph">
            As a data subject under the PDPA, you have the right to:
          </p>
          <ul className="modal-list">
            <li>
              <strong>Access</strong> — request a copy of the personal data we
              hold about you.
            </li>
            <li>
              <strong>Correction</strong> — request correction of inaccurate or
              incomplete data.
            </li>
            <li>
              <strong>Withdrawal of consent</strong> — withdraw consent for the
              processing of sensitive personal data at any time (note: this may
              affect your ability to participate in certain events).
            </li>
            <li>
              <strong>Data deletion</strong> — request deletion of your account
              and associated personal data, subject to our retention
              obligations.
            </li>
          </ul>
          <p className="modal-paragraph">
            To exercise any of these rights, contact us at{" "}
            <strong>privacy@mychesstour.com</strong>.
          </p>

          <h3 className="modal-section-title">7. Sharing of Data</h3>
          <p className="modal-paragraph">
            We may share your data with the following third parties only where
            necessary:
          </p>
          <ul className="modal-list">
            <li>
              <strong>FIDE</strong> — for rating submission and player
              registration.
            </li>
            <li>
              <strong>Malaysian Chess Federation (MCF)</strong> — for MCF-rated
              event registration.
            </li>
            <li>
              <strong>Tournament organisers</strong> — name, FIDE/MCF ID, and
              rating for pairing and certification purposes.
            </li>
            <li>
              <strong>Payment processors</strong> — for processing entry fees
              and prize disbursements.
            </li>
          </ul>

          <h3 className="modal-section-title">8. Cookies</h3>
          <p className="modal-paragraph">
            We use session cookies essential for authentication and platform
            functionality. We do not use advertising or tracking cookies.
          </p>

          <h3 className="modal-section-title">9. Changes to This Policy</h3>
          <p className="modal-paragraph">
            We may update this Privacy Policy from time to time. We will notify
            you of significant changes via email or a platform notice at least
            14 days before they take effect.
          </p>

          <h3 className="modal-section-title">10. Contact Us</h3>
          <p className="modal-paragraph">
            For privacy-related inquiries or to exercise your PDPA rights,
            contact our Data Protection Officer at{" "}
            <strong>privacy@mychesstour.com</strong>.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
