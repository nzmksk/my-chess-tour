"use client";

import { useEffect } from "react";
import { TERMS_VERSION, formatLegalVersion } from "@/lib/reference/legal";

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
            <strong>Effective Date: {formatLegalVersion(TERMS_VERSION)}</strong>
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
              OKU (disability) status — collected to facilitate accessibility
              requirements at events and for OKU categories and prizes
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
            <strong>Business Verification Data</strong> (organisers only)
          </p>
          <ul className="modal-list">
            <li>
              SSM or ROS registration documents, and supporting evidence of the
              organisation&apos;s standing
            </li>
            <li>Registered business address and contact details</li>
            <li>
              Name and role of the authorised representative accepting the
              Organizer Agreement
            </li>
            <li>Bank account details used to receive tournament payouts</li>
          </ul>

          <p className="modal-paragraph">
            <strong>Tournament & Registration Data</strong>
          </p>
          <ul className="modal-list">
            <li>Tournament registration records</li>
            <li>Payment records (amounts, dates, transaction IDs)</li>
          </ul>

          <h3 className="modal-section-title">
            2. Sensitive Personal Data and Separate Consent
          </h3>
          <p className="modal-paragraph">
            Some personal data needs more than your agreement to this policy.
            Health data (your OKU card and the disability status it proves) and
            financial data (your bank details) are each collected only with
            their own explicit consent: a separate checkbox, shown when you give
            us that data, never pre-ticked and never combined with accepting
            these terms. We record when you consented and to which wording. The
            table below lists the data that needs this kind of care, and which
            of it needs your separate consent:
          </p>
          <table className="modal-table">
            <thead>
              <tr>
                <th>Data Field</th>
                <th>Separate Consent</th>
                <th>Reason for Collection</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>OKU (disability) status and OKU card</td>
                <td>Required</td>
                <td>
                  Health data. Used for event accessibility, FIDE Special Needs
                  registration, and OKU categories and special prizes. Your card
                  is seen only by our reviewers. Whether you are verified OKU is
                  shared with the organisers of tournaments you enter, but never
                  your card or the outcome of a pending or rejected application
                </td>
              </tr>
              <tr>
                <td>Bank details (bank, account holder, account number)</td>
                <td>Required</td>
                <td>
                  Financial data. Used to pay you prizes distributed through MY
                  Chess Tour, and shared with CHIP, our payment processor, to
                  verify the account and make the transfer. Never shared with
                  organisers
                </td>
              </tr>
              <tr>
                <td>Date of birth</td>
                <td>Not required</td>
                <td>
                  Age-category eligibility; identity verification; shared with
                  the organisers of tournaments you enter
                </td>
              </tr>
              <tr>
                <td>Gender</td>
                <td>Not required</td>
                <td>
                  Gender-restricted event categories (e.g. Women&apos;s Open);
                  shared with the organisers of tournaments you enter
                </td>
              </tr>
            </tbody>
          </table>
          <p className="modal-paragraph">
            You can withdraw either separate consent at any time in Settings.
            Withdrawing consent for your health data deletes your OKU card and
            removes your OKU verification. Removing your bank details withdraws
            consent for your financial data and deletes them, except that for an
            account a prize was sent to we keep the bank, account holder name
            and last 4 digits of the account number as part of the payment
            record, as described under Data Retention. Date of birth and gender
            are used as described above once you add them to your profile.
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
              <tr>
                <td>Audit and change-history records</td>
                <td>
                  History of payments, refunds, payouts, prizes, bank accounts
                  and tournaments retained for 7 years. Other change history
                  deleted after 1 year, or after 30 days for a registration that
                  was never paid. Personal fields anonymised alongside the
                  account
                </td>
              </tr>
              <tr>
                <td>Error reports (Sentry)</td>
                <td>30 days, then deleted automatically</td>
              </tr>
              <tr>
                <td>Usage analytics (PostHog)</td>
                <td>1 year, then deleted automatically</td>
              </tr>
              <tr>
                <td>Business verification documents (organisers)</td>
                <td>Up to 1 year after the organiser partnership ends</td>
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
              All data is encrypted in transit, over secure connections
              (HTTPS/TLS).
            </li>
            <li>
              All data we store, including your bank details and any documents
              you upload, is encrypted at rest in our database and file storage.
            </li>
            <li>
              Once saved, your full bank account number is never shown again:
              the platform and our emails show only its last 4 digits. It is
              also masked in our internal change logs, so no historical copies
              of it are kept there.
            </li>
            <li>
              Access is enforced at the database level by row-level security, so
              one user&apos;s records are not readable by another.
            </li>
            <li>
              Sensitive personal data (OKU status, date of birth, gender) and
              financial data (bank details) are restricted to the specific
              features that need them, and to authorised personnel. Date of
              birth, gender and verified OKU status are also shared with the
              organisers of tournaments you enter, as described under Sharing of
              Data.
            </li>
            <li>
              OKU cards and verification documents are held in private storage
              that is not publicly reachable, are reviewed only by platform
              administrators, and their storage locations are masked in our
              internal change logs.
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
              processing of your health or financial data at any time, in
              Settings or by contacting us. Withdrawing may affect your ability
              to enter OKU categories or receive prizes paid through MY Chess
              Tour.
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
              <strong>Tournament organisers</strong> — for each tournament you
              enter, its organiser receives your name, title, FIDE and MCF IDs
              and ratings, gender, date of birth, nationality and whether you
              are verified OKU, and can download them as a participant list.
              They use these for pairing, for age, gender and OKU categories and
              special prizes, and for certification. Your OKU card, any pending
              or rejected OKU application, and your contact details are not
              shared.
            </li>
            <li>
              <strong>CHIP (chip-in.asia)</strong> — our licensed payment
              processor, which receives the details needed to collect entry fees
              and to disburse organiser payouts and prizes, including bank
              account details.
            </li>
            <li>
              <strong>Sentry (sentry.io)</strong> — our error-monitoring
              service. When something goes wrong on the platform, it receives a
              technical report of the error, which may include details from the
              request that failed, such as an account identifier or information
              you submitted. Sentry&apos;s servers are in the United States, so
              these reports are processed outside Malaysia. We do not send your
              IP address or cookies, and reports are deleted after 30 days.
            </li>
            <li>
              <strong>PostHog (posthog.com)</strong> — our usage-analytics
              service. It receives which pages you visit and what you click on
              them, your browser and device type, and an approximate location
              worked out from your IP address, which PostHog does not store. It
              works without cookies or anything else stored on your device, it
              is not linked to your account, and we remove sign-in codes and
              other private details from page addresses before they are sent.
              PostHog&apos;s servers are in the United States, so this data is
              processed outside Malaysia.
            </li>
          </ul>
          <p className="modal-paragraph">
            Business verification documents are not shared with third parties.
            They are reviewed by platform administrators and disclosed further
            only where the law requires it.
          </p>

          <h3 className="modal-section-title">8. Cookies</h3>
          <p className="modal-paragraph">
            We use session cookies essential for authentication and platform
            functionality. We do not use advertising or tracking cookies. Our
            usage analytics (PostHog, section 7) works without cookies or any
            other storage on your device.
          </p>

          <h3 className="modal-section-title">9. Changes to This Policy</h3>
          <p className="modal-paragraph">
            We may update this Privacy Policy from time to time. We will notify
            you of significant changes via email or a platform notice at least
            14 days before they take effect.
          </p>

          <h3 className="modal-section-title">10. Contact Us</h3>
          <p className="modal-paragraph">
            For privacy-related inquiries or to exercise your PDPA rights, email
            us at <strong>privacy@mychesstour.com</strong>.
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
