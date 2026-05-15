import NavBar from "@/components/NavBar";

export const metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for MY Chess Tour — Malaysia's premier competitive chess circuit.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="card card--featured p-8">
          <div className="text-center mb-8">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Terms of Service</h1>
            <p className="auth-subheading">Effective Date: 1 June 2025</p>
            <hr className="divider-gold" />
          </div>

          <div className="font-lato text-sm text-text-body leading-relaxed space-y-6">
            <p className="text-text-secondary">
              Welcome to MY Chess Tour (&quot;MCT&quot;, &quot;we&quot;,
              &quot;us&quot;, or &quot;our&quot;). These Terms of Service govern
              your use of our platform and services. By creating an account or
              participating in any tournament, you agree to these terms.
            </p>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                1. Acceptance of Terms
              </h2>
              <p className="text-text-secondary">
                By registering for an account or using any MCT service, you
                confirm that you are at least 13 years of age (or have parental
                consent) and that you agree to be bound by these Terms and our
                Privacy Policy. If you do not agree, you may not use our
                services.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                2. Account Registration
              </h2>
              <p className="text-text-secondary mb-2">
                You must provide accurate, complete, and up-to-date information
                when creating an account. Your name must match the name on your
                national identity card (MyKad) or passport, as it is used for
                official tournament records and FIDE/MCF registration.
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>You are responsible for maintaining the security of your account.</li>
                <li>You must not share your credentials with any other person.</li>
                <li>
                  You must notify us immediately if you suspect unauthorised
                  access to your account.
                </li>
                <li>Each individual may only maintain one active account.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                3. Tournament Participation
              </h2>
              <p className="text-text-secondary mb-2">
                All tournaments hosted on MY Chess Tour are governed by the Laws
                of Chess as published by FIDE, unless otherwise specified by the
                tournament arbiter. By registering for a tournament, you agree
                to:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>
                  Abide by all rules and decisions made by the chief arbiter.
                </li>
                <li>
                  Compete with integrity and without the use of computer
                  assistance or other prohibited aids during play.
                </li>
                <li>
                  Provide accurate FIDE ID and/or MCF ID where required for
                  rated events.
                </li>
                <li>
                  Accept that results are final unless a formal appeal is
                  submitted within the time prescribed by the arbiter.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                4. Payment &amp; Refund Policy
              </h2>
              <p className="text-text-secondary mb-2">
                Tournament entry fees are stated on the event page and are
                collected by the tournament organiser. Refund eligibility is
                determined by the organiser&apos;s policy for that event, which
                will be displayed during registration. MY Chess Tour is not
                liable for any disputes between players and organisers regarding
                refunds.
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>
                  Prize money disbursement is the sole responsibility of the
                  tournament organiser.
                </li>
                <li>
                  MY Chess Tour may collect a platform service fee, which will
                  be disclosed at the time of registration.
                </li>
                <li>
                  All fees are in Malaysian Ringgit (MYR) unless stated
                  otherwise.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                5. Code of Conduct
              </h2>
              <p className="text-text-secondary mb-2">
                We are committed to a respectful and inclusive environment. All
                users must:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>
                  Treat fellow players, organisers, and arbiters with respect.
                </li>
                <li>
                  Refrain from harassment, discrimination, or abusive language
                  on the platform or at events.
                </li>
                <li>
                  Not engage in cheating, sandbagging, or manipulation of
                  ratings.
                </li>
                <li>
                  Comply with any anti-doping requirements applicable to the
                  event.
                </li>
              </ul>
              <p className="text-text-secondary mt-2">
                Violations may result in account suspension, disqualification
                from events, or reporting to the Malaysian Chess Federation (MCF)
                and FIDE.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                6. Intellectual Property
              </h2>
              <p className="text-text-secondary">
                All content on the MY Chess Tour platform — including logos,
                graphics, software, and tournament data — is owned by or licensed
                to MCT. You may not reproduce, distribute, or create derivative
                works without our written permission.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                7. Limitation of Liability
              </h2>
              <p className="text-text-secondary">
                MY Chess Tour provides its platform on an &quot;as is&quot;
                basis. To the fullest extent permitted by Malaysian law, we are
                not liable for any indirect, incidental, or consequential damages
                arising from your use of the platform or participation in any
                event.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                8. Amendments
              </h2>
              <p className="text-text-secondary">
                We may update these Terms from time to time. We will notify you
                of material changes via email or a prominent notice on the
                platform. Continued use of the platform after changes constitutes
                acceptance of the revised Terms.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                9. Governing Law
              </h2>
              <p className="text-text-secondary">
                These Terms are governed by the laws of Malaysia. Any disputes
                shall be subject to the exclusive jurisdiction of the courts of
                Kuala Lumpur, Malaysia.
              </p>
            </section>

            <section>
              <h2 className="font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3">
                10. Contact Us
              </h2>
              <p className="text-text-secondary">
                For questions about these Terms, please contact us at{" "}
                <strong>support@mychesstour.com</strong>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
