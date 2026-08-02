import NavBar from "@/components/NavBar";
import { ORGANIZER_AGREEMENT_VERSION, formatLegalVersion } from "@/lib/legal";

export const metadata = {
  title: "Organizer Agreement",
  description:
    "The agreement between MY Chess Tour and tournament organizers — entry fees, commission, payouts, refunds and liability.",
};

const H2 =
  "font-cinzel text-sm font-semibold tracking-widest uppercase text-gold-muted mb-3";
const UL = "list-disc pl-5 space-y-1 text-text-secondary";

export default function OrganizerAgreementPage() {
  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="card card--featured p-8">
          <div className="mb-8 text-center">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Organizer Agreement</h1>
            <p className="auth-subheading">
              Version {ORGANIZER_AGREEMENT_VERSION} — Effective{" "}
              {formatLegalVersion(ORGANIZER_AGREEMENT_VERSION)}
            </p>
            <hr className="divider-gold" />
          </div>

          <div className="font-lato text-text-body space-y-6 text-sm leading-relaxed">
            <p className="text-text-secondary">
              This Agreement is between MY Chess Tour (&quot;MCT&quot;,
              &quot;we&quot;, &quot;us&quot;) and the organization accepting it
              (&quot;you&quot;, &quot;the organizer&quot;). It governs how entry
              fees are collected on your behalf, what we deduct, when and how
              you are paid, and what you owe back if a tournament does not go
              ahead. It applies in addition to our Terms of Service and Privacy
              Policy. Accepting it is a condition of listing a tournament and of
              receiving any payout.
            </p>

            <section>
              <h2 className={H2}>1. Nature of Entry Fees</h2>
              <p className="text-text-secondary mb-2">
                Entry fees collected through the platform are an{" "}
                <strong>administration fee</strong> paid by each player in
                exchange for you organizing the event — venue, arbiters,
                equipment, staffing, and national or FIDE rating fees. They are
                consideration for a service rendered.
              </p>
              <p className="text-text-secondary">
                Entry fees are not a stake, a wager, or a contribution to a pool
                that any competitor may win. They do not fund prizes, and no
                portion of any player&apos;s entry fee is redistributed to
                another player as winnings.
              </p>
            </section>

            <section>
              <h2 className={H2}>2. Prize Funding</h2>
              <p className="text-text-secondary mb-2">
                Every prize you declare must be funded from a source outside the
                entry fees. When you create a tournament you must name that
                source for each prize:
              </p>
              <ul className={UL}>
                <li>a sponsor;</li>
                <li>a grant or government funding; or</li>
                <li>your organization&apos;s own funds.</li>
              </ul>
              <p className="text-text-secondary mt-2">
                You warrant that the source you declare is accurate and that the
                money is or will be available. A tournament whose declared
                prizes have no external source cannot be published. Misdeclaring
                a funding source is a material breach of this Agreement.
              </p>
            </section>

            <section>
              <h2 className={H2}>3. Commission and Fees</h2>
              <p className="text-text-secondary mb-2">
                MCT charges a platform commission of up to <strong>10%</strong>{" "}
                of the entry fee you set. For each tournament you choose how
                that commission is borne, by setting the share your organization
                absorbs against the share added to the player&apos;s price:
              </p>
              <ul className={UL}>
                <li>
                  absorb none, and the full commission is added on top of your
                  entry fee at checkout;
                </li>
                <li>
                  absorb all of it, and the player pays exactly your entry fee
                  while the commission is deducted from your revenue; or
                </li>
                <li>any split between the two.</li>
              </ul>
              <p className="text-text-secondary mt-2">
                The price a player pays is always shown in full before they pay.
                Payment processing charges levied by our payment processor are
                borne by MCT out of the commission, except where a transfer
                fails because of details you supplied (see clause 11).
              </p>
            </section>

            <section>
              <h2 className={H2}>4. Payout Schedule</h2>
              <p className="text-text-secondary mb-2">
                Your payout is your net revenue in full — entry fees collected,
                less the commission, less any refunds issued. Prize money is
                never deducted from it.
              </p>
              <ul className={UL}>
                <li>
                  Payouts are disbursed automatically{" "}
                  <strong>
                    three days after the tournament&apos;s final scheduled
                    session
                  </strong>
                  , calculated in the venue&apos;s own timezone.
                </li>
                <li>
                  Payouts are made in Malaysian Ringgit (MYR) only, to a
                  verified bank account held in Malaysia.
                </li>
                <li>
                  A payout is only released once the balance reaches a minimum
                  of <strong>RM 10.00</strong>. Amounts below that are carried
                  forward.
                </li>
                <li>
                  A zero balance is a normal outcome, not an error — it means
                  nothing is currently payable.
                </li>
              </ul>
            </section>

            <section>
              <h2 className={H2}>5. Early Payouts</h2>
              <p className="text-text-secondary mb-2">
                You may request payment of part of your revenue before the
                tournament ends. Early payouts are granted{" "}
                <strong>at the platform&apos;s sole discretion</strong> and are
                subject to all of the following:
              </p>
              <ul className={UL}>
                <li>registration for the tournament must have closed;</li>
                <li>
                  the total advanced must not exceed <strong>50%</strong> of net
                  revenue at the time of the request;
                </li>
                <li>
                  at most <strong>two</strong> early payouts per tournament;
                </li>
                <li>
                  no early payout is available where a third-party beneficiary
                  has been nominated (clause 6); and
                </li>
                <li>
                  no early payout is available while a cancellation request or
                  an unresolved refund is outstanding.
                </li>
              </ul>
              <p className="text-text-secondary mt-2">
                A refused request is not a breach by us and creates no
                entitlement to reasons.
              </p>
            </section>

            <section>
              <h2 className={H2}>6. Nominating a Beneficiary</h2>
              <p className="text-text-secondary">
                You may nominate another organization approved on the platform
                to receive the payout for a tournament in your place. The
                nominated organization must be in good standing and hold a
                verified bank account. Nominating a beneficiary changes only who
                receives the money:{" "}
                <strong>
                  you remain fully liable under this Agreement regardless of who
                  is paid
                </strong>
                , including for refunds, claw-back and any shortfall. Payment to
                the beneficiary discharges our obligation to you in full, and
                any dispute between you and the beneficiary is a matter between
                you.
              </p>
            </section>

            <section>
              <h2 className={H2}>7. Refunds and Cancellation</h2>
              <p className="text-text-secondary mb-2">
                Cancelling a published tournament requires our approval. Where a
                cancellation is approved:
              </p>
              <ul className={UL}>
                <li>
                  every confirmed player is refunded{" "}
                  <strong>in full, including commission</strong> — the player is
                  made whole for everything they paid;
                </li>
                <li>
                  your revenue for that tournament goes to zero, and no payout
                  is made; and
                </li>
                <li>
                  MCT does not retain its commission on a cancelled tournament.
                </li>
              </ul>
              <p className="text-text-secondary mt-2">
                Refunds to individual players outside a cancellation are
                governed by the refund policy shown on your tournament page at
                the time of registration.
              </p>
            </section>

            <section>
              <h2 className={H2}>8. Claw-back of Advances</h2>
              <p className="text-text-secondary">
                An early payout is an{" "}
                <strong>
                  advance against revenue that has not yet been earned
                </strong>
                , not a final settlement. If the tournament is subsequently
                cancelled, or refunds reduce your net revenue below the amount
                already advanced, the difference becomes immediately repayable
                by you on demand. We may recover it by deducting from payouts
                due to you on any other tournament, by invoicing you directly,
                or by both. This obligation survives termination of this
                Agreement and applies regardless of whether a beneficiary
                received the funds.
              </p>
            </section>

            <section>
              <h2 className={H2}>9. Platform-Managed Prize Distribution</h2>
              <p className="text-text-secondary mb-2">
                By default you pay your winners directly and MCT is not
                involved. You may instead appoint MCT to collect and distribute
                the prize pool for a tournament. Where you do:
              </p>
              <ul className={UL}>
                <li>
                  the full declared prize pool must be paid to MCT and cleared{" "}
                  <strong>before any winner is paid</strong>; a partially funded
                  pool is not distributed;
                </li>
                <li>
                  prize money is held separately from your entry-fee revenue and
                  is never applied against your payouts, commission or
                  claw-back;
                </li>
                <li>
                  distribution follows the final results as certified by the
                  tournament arbiter;
                </li>
                <li>
                  a prize that remains unclaimed twelve months after the
                  tournament ends is returned to the party that funded it, less
                  any transfer costs; and
                </li>
                <li>
                  if the tournament is cancelled before results are certified,
                  the entire pool is returned to the funder.
                </li>
              </ul>
            </section>

            <section>
              <h2 className={H2}>10. Changes to a Tournament</h2>
              <p className="text-text-secondary mb-2">
                Players commit money on the strength of what your listing says,
                so a listing freezes in two stages:
              </p>
              <ul className={UL}>
                <li>
                  as soon as one player has paid, the{" "}
                  <strong>money fields lock</strong> — entry fees, commission
                  settings, and declared prizes can no longer be changed; and
                </li>
                <li>
                  when the tournament starts,{" "}
                  <strong>everything else locks</strong>.
                </li>
              </ul>
              <p className="text-text-secondary mt-2">
                A change that would materially disadvantage players who have
                already paid — a different venue, a different date, a reduced
                prize fund — must be handled as a cancellation and refund, not
                as an edit.
              </p>
            </section>

            <section>
              <h2 className={H2}>11. Bank Details and Verification</h2>
              <p className="text-text-secondary mb-2">
                You are responsible for the accuracy of the bank details you
                provide, and for keeping them current.
              </p>
              <ul className={UL}>
                <li>
                  A transfer that fails, is delayed, or reaches the wrong
                  recipient because of details you supplied is your cost, not
                  ours, including any charge levied by the receiving bank.
                </li>
                <li>
                  Business verification documents (SSM or ROS registration and
                  supporting evidence) must be current, genuine, and
                  legitimately yours. Submitting a false or altered document
                  terminates this Agreement immediately.
                </li>
                <li>
                  We may re-verify your organization or bank details at any time
                  and may hold payouts while verification is outstanding.
                </li>
              </ul>
            </section>

            <section>
              <h2 className={H2}>12. Payment Processor</h2>
              <p className="text-text-secondary">
                Collection from players and disbursement to you are performed by
                CHIP (chip-in.asia), our licensed payment processor. Funds are
                held by the processor, not by MCT, until disbursed. The
                processor&apos;s own record of a transaction is authoritative as
                to whether and when a payment or transfer occurred. Your use of
                the platform is additionally subject to the processor&apos;s
                terms where they apply to you.
              </p>
            </section>

            <section>
              <h2 className={H2}>13. Withholding and Suspension</h2>
              <p className="text-text-secondary mb-2">
                We may withhold a payout, suspend your ability to publish
                tournaments, or both, where:
              </p>
              <ul className={UL}>
                <li>we reasonably suspect fraud or misrepresentation;</li>
                <li>
                  a player dispute, chargeback or refund claim is unresolved;
                </li>
                <li>
                  business verification has failed, lapsed, or is under review;
                </li>
                <li>a repayable amount under clause 8 is outstanding; or</li>
                <li>we are required to do so by law or by our processor.</li>
              </ul>
              <p className="text-text-secondary mt-2">
                We will tell you why, and release the payout once the reason is
                resolved. Withholding is not forfeiture: money that is properly
                yours remains yours.
              </p>
            </section>

            <section>
              <h2 className={H2}>14. Amendments and Re-acceptance</h2>
              <p className="text-text-secondary">
                This Agreement is versioned and dated. When we publish a new
                version we will notify you, and your organization must accept it
                before further payouts are released. Continuing to use the
                platform does not by itself constitute acceptance of a new
                version — an explicit acceptance is recorded against your
                organization, together with the version, the time, and the
                person who accepted it. Tournaments already published continue
                to run under the terms of the version in force when they were
                published.
              </p>
            </section>

            <section>
              <h2 className={H2}>15. Governing Law and Contact</h2>
              <p className="text-text-secondary">
                This Agreement is governed by the laws of Malaysia, and the
                courts of Kuala Lumpur have exclusive jurisdiction over any
                dispute arising from it. For questions about this Agreement,
                contact us at <strong>support@mychesstour.com</strong>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
