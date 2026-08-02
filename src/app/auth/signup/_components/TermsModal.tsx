"use client";

import { useEffect } from "react";
import { TERMS_VERSION, formatLegalVersion } from "@/lib/legal";

interface TermsModalProps {
  onClose: () => void;
}

export default function TermsModal({ onClose }: TermsModalProps) {
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
      aria-labelledby="terms-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--featured">
        <div className="modal-header">
          <h2 id="terms-modal-title" className="modal-title">
            Terms of Service
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close Terms of Service"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-paragraph">
            <strong>Effective Date: {formatLegalVersion(TERMS_VERSION)}</strong>
          </p>
          <p className="modal-paragraph">
            Welcome to MY Chess Tour (&quot;MCT&quot;, &quot;we&quot;,
            &quot;us&quot;, or &quot;our&quot;). These Terms of Service govern
            your use of our platform and services. By creating an account or
            participating in any tournament, you agree to these terms.
          </p>

          <h3 className="modal-section-title">1. Acceptance of Terms</h3>
          <p className="modal-paragraph">
            By registering for an account or using any MCT service, you confirm
            that you are at least 13 years of age (or have parental consent) and
            that you agree to be bound by these Terms and our Privacy Policy. If
            you do not agree, you may not use our services.
          </p>

          <h3 className="modal-section-title">2. Account Registration</h3>
          <p className="modal-paragraph">
            You must provide accurate, complete, and up-to-date information when
            creating an account. Your name must match the name on your national
            identity card (MyKad) or passport, as it is used for official
            tournament records and FIDE/MCF registration.
          </p>
          <ul className="modal-list">
            <li>
              You are responsible for maintaining the security of your account.
            </li>
            <li>You must not share your credentials with any other person.</li>
            <li>
              You must notify us immediately if you suspect unauthorised access
              to your account.
            </li>
            <li>Each individual may only maintain one active account.</li>
          </ul>

          <h3 className="modal-section-title">3. Tournament Participation</h3>
          <p className="modal-paragraph">
            All tournaments hosted on MY Chess Tour are governed by the Laws of
            Chess as published by FIDE, unless otherwise specified by the
            tournament arbiter. By registering for a tournament, you agree to:
          </p>
          <ul className="modal-list">
            <li>Abide by all rules and decisions made by the chief arbiter.</li>
            <li>
              Compete with integrity and without the use of computer assistance
              or other prohibited aids during play.
            </li>
            <li>
              Provide accurate FIDE ID and/or MCF ID where required for rated
              events.
            </li>
            <li>
              Accept that results are final unless a formal appeal is submitted
              within the time prescribed by the arbiter.
            </li>
          </ul>

          <h3 className="modal-section-title">4. Payment & Refund Policy</h3>
          <p className="modal-paragraph">
            Tournament entry fees are stated on the event page and are collected
            by MY Chess Tour on the organiser&apos;s behalf, then paid out to
            them under our Organizer Agreement. Refund eligibility is determined
            by the organiser&apos;s policy for that event, which is displayed
            during registration.
          </p>
          <ul className="modal-list">
            <li>
              Your entry fee pays for the running of the event — venue,
              arbiters, equipment and rating fees. It is not a stake, and no
              part of it is paid out to another player as prize money.
            </li>
            <li>
              Prize money is funded separately by the organiser, a sponsor or a
              grant, and is distributed by the organiser — unless they have
              appointed MY Chess Tour to distribute a fully funded prize pool
              for that event.
            </li>
            <li>
              MY Chess Tour collects a platform service fee of up to 10%. The
              total you pay is always shown in full before you pay.
            </li>
            <li>
              If an event is cancelled with our approval, every confirmed player
              is refunded in full, including the service fee.
            </li>
            <li>
              All fees are in Malaysian Ringgit (MYR) unless stated otherwise.
            </li>
          </ul>

          <h3 className="modal-section-title">5. Organisers</h3>
          <p className="modal-paragraph">
            Organising tournaments on MY Chess Tour requires an approved
            organization and acceptance of our{" "}
            <a
              href="/organizer-agreement"
              target="_blank"
              rel="noopener noreferrer"
              className="modal-trigger-link"
            >
              Organizer Agreement
            </a>
            , which governs commission, payout timing, refunds, prize funding
            and liability. Nothing in that agreement reduces our obligations to
            players under these Terms.
          </p>

          <h3 className="modal-section-title">6. Code of Conduct</h3>
          <p className="modal-paragraph">
            We are committed to a respectful and inclusive environment. All
            users must:
          </p>
          <ul className="modal-list">
            <li>
              Treat fellow players, organisers, and arbiters with respect.
            </li>
            <li>
              Refrain from harassment, discrimination, or abusive language on
              the platform or at events.
            </li>
            <li>
              Not engage in cheating, sandbagging, or manipulation of ratings.
            </li>
            <li>
              Comply with any anti-doping requirements applicable to the event.
            </li>
          </ul>
          <p className="modal-paragraph">
            Violations may result in account suspension, disqualification from
            events, or reporting to the Malaysian Chess Federation (MCF) and
            FIDE.
          </p>

          <h3 className="modal-section-title">7. Intellectual Property</h3>
          <p className="modal-paragraph">
            All content on the MY Chess Tour platform — including logos,
            graphics, software, and tournament data — is owned by or licensed to
            MCT. You may not reproduce, distribute, or create derivative works
            without our written permission.
          </p>

          <h3 className="modal-section-title">8. Limitation of Liability</h3>
          <p className="modal-paragraph">
            MY Chess Tour provides its platform on an &quot;as is&quot; basis.
            To the fullest extent permitted by Malaysian law, we are not liable
            for any indirect, incidental, or consequential damages arising from
            your use of the platform or participation in any event.
          </p>

          <h3 className="modal-section-title">9. Amendments</h3>
          <p className="modal-paragraph">
            We may update these Terms from time to time. We will notify you of
            material changes via email or a prominent notice on the platform.
            Continued use of the platform after changes constitutes acceptance
            of the revised Terms.
          </p>

          <h3 className="modal-section-title">10. Governing Law</h3>
          <p className="modal-paragraph">
            These Terms are governed by the laws of Malaysia. Any disputes shall
            be subject to the exclusive jurisdiction of the courts of Kuala
            Lumpur, Malaysia.
          </p>

          <h3 className="modal-section-title">11. Contact Us</h3>
          <p className="modal-paragraph">
            For questions about these Terms, please contact us at{" "}
            <strong>support@mychesstour.com</strong>.
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
