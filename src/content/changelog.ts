import type { ChangelogEntry } from "@/lib/changelog";

/**
 * What changed in each release, for players and organizers rather than
 * developers (#622). Newest first. Every release tag needs an entry here, and
 * `version` must be the tag exactly (the footer shows the same value, #621);
 * CI fails otherwise. Write the entry in the release PR, before the tag is cut:
 * builds only show it once they carry the tag.
 *
 * Write for someone who has never seen the code: what they can do now, or what
 * works better, in a sentence. Leave out internal changes, or mark a release
 * with nothing user-visible `silent: true` to keep it out of the dialog.
 * How to cut a release: wiki/releases.md.
 */
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "v0.11.0-alpha",
    date: "2026-11-19",
    headline:
      "Tournaments up front, and an easier way to tell us what's broken.",
    new: [
      "Spotted something wrong? Use the “Report a bug” button on any page to tell us, no account needed.",
      "After each release you'll see a short note like this one about what changed. Every past release is listed on the new Changelog page.",
      "The footer shows which version of MY Chess Tour you're using. Mention it when you report a bug.",
      "Your OKU card and your bank details each need their own consent before we store them. You can withdraw that consent in Settings, which deletes the data.",
    ],
    improved: [
      "The tournament list is now the home page. Old links to /tournaments still work.",
      "Every page now has a footer with links to the Terms, Privacy Policy and Organizer Agreement.",
      "We use a single support email address everywhere.",
      "My Tournaments keeps a multi-day event under Upcoming until its last day ends, in the venue's time zone.",
      "Actions repeated very quickly are now briefly limited, to protect the site from abuse.",
    ],
  },
  {
    version: "v0.10.0-alpha",
    date: "2026-11-18",
    headline:
      "Refunds you can follow, member invitations and participant exports.",
    new: [
      "Players and organizers can see the status of each refund, and players get an email when a refund goes through or fails.",
      "Organizers can download their participant list as a CSV or Excel file.",
      "Invitations to join an organization can be accepted or declined, and expire after 30 days.",
      "Organizers are paid automatically a few days after their tournament ends.",
      "Platform-run tournaments can be funded by sponsors, with prizes paid out of the money collected.",
      "The tournament editor has a Cancel button.",
    ],
    improved: [
      "Entry fees are listed cheapest first, and the “from” price is one you can actually pay.",
      "The message after adding a member says which role they were invited to.",
      "Pages respond faster after actions that send emails or start refunds.",
      "Security updates.",
    ],
    fixed: [
      "An organizer can no longer lower a tournament's capacity below the number of places already taken.",
    ],
  },
  {
    version: "v0.9.6-alpha",
    date: "2026-11-15",
    improved: [
      "Editing a published tournament only allows the changes that are safe at its current stage, such as once registration has opened.",
      "Behind-the-scenes improvements to how payments are recorded.",
    ],
  },
  {
    version: "v0.9.5-alpha",
    date: "2026-11-14",
    headline: "Emails for the moments that matter.",
    new: [
      "You get an email when you register for a tournament, when an organization application is decided, and when your OKU verification is reviewed.",
      "Organizers can ask for part of their tournament revenue early, before the tournament ends.",
    ],
    improved: ["Error messages no longer show technical details."],
  },
  {
    version: "v0.9.4-alpha",
    date: "2026-11-12",
    improved: [
      "When you delete your account, your name is also removed from the activity history.",
      "We're alerted automatically when something goes wrong, so we can fix it sooner.",
    ],
    fixed: [
      "Invitations to join an organization failed for some email addresses that already had an account.",
    ],
  },
  {
    version: "v0.9.3-alpha",
    date: "2026-11-09",
    fixed: [
      "Payouts to organizers account for the transfer fee, and a payout larger than the available balance is refused instead of failing part-way.",
    ],
  },
  {
    version: "v0.9.2-alpha",
    date: "2026-11-09",
    improved: [
      "Organizer payouts are recorded and sent to the organization's verified bank account.",
    ],
    fixed: ["Draft tournaments can be published again."],
  },
  {
    version: "v0.9.1-alpha",
    date: "2026-11-04",
    improved: [
      "Organizers' bank accounts are verified before any payout is sent.",
      "Security updates.",
    ],
    fixed: [
      "DuitNow QR payments work with our payment provider's latest setup.",
    ],
  },
  {
    version: "v0.9.0-alpha",
    date: "2026-11-01",
    headline: "Venue time zones, and getting organizers ready to be paid.",
    new: [
      "Each tournament has its own time zone, and its dates and times are shown in it.",
      "Organizers accept the Organizer Agreement, and we keep a record of which version of the Terms you agreed to.",
      "Organizers can add their bank details and upload business verification documents.",
    ],
    improved: ["Security updates."],
    fixed: [
      "Resuming a draft tournament keeps its entry fee rules.",
      "Special prizes display correctly.",
    ],
  },
  {
    version: "v0.8.0-alpha",
    date: "2026-07-26",
    new: [
      "When a tournament is cancelled, registered players are refunded automatically.",
    ],
  },
  {
    version: "v0.7.0-alpha",
    date: "2026-07-22",
    new: [
      "Organizers who belong to more than one organization can switch between them.",
      "Organizers can cancel a tournament, and registered players are told by email.",
    ],
    fixed: [
      "The registration closing time is recorded correctly when a tournament is published or closed early.",
    ],
  },
  {
    version: "v0.6.2-alpha",
    date: "2026-07-05",
    fixed: [
      "Registering for a free (RM0) entry works.",
      "Entry fees show cents.",
      "Eligibility restrictions display correctly.",
      "Upcoming and past tournaments in My Tournaments are in the right order.",
    ],
  },
  {
    version: "v0.6.1-alpha",
    date: "2026-07-04",
    fixed: [
      "Revenue and payout figures on the organizer dashboard are correct.",
    ],
  },
  {
    version: "v0.6.0-alpha",
    date: "2026-07-04",
    headline: "A shorter sign-up, and OKU verification.",
    new: [
      "Upload your OKU card for verification to enter OKU categories and prizes.",
      "Players can add bank details to receive prize money.",
      "FIDE ratings are updated automatically every month.",
    ],
    improved: [
      "Signing up is shorter: we only ask for your player details when you register for a tournament that needs them.",
    ],
    fixed: ["Ages for age categories are calculated correctly."],
  },
  {
    version: "v0.5.7-alpha",
    date: "2026-06-30",
    improved: [
      "Tournament links use the tournament's name instead of a code.",
      "Changes to a tournament show up in the list straight away.",
    ],
    fixed: [
      "Full tournaments can still be opened from the list, and say they're full instead of asking you to sign in.",
    ],
  },
  {
    version: "v0.5.6-alpha",
    date: "2026-06-28",
    improved: [
      "Returning to an unfinished payment picks up where you left off instead of starting again.",
      "Pages load faster for signed-in users.",
    ],
    fixed: ["Payments that time out are handled correctly."],
  },
  {
    version: "v0.5.5-alpha",
    date: "2026-06-26",
    fixed: [
      "Payment confirmations from our payment provider are received reliably.",
    ],
  },
  {
    version: "v0.5.4-alpha",
    date: "2026-06-26",
    improved: [
      "Extra safeguards against being charged twice for the same registration.",
    ],
  },
  {
    version: "v0.5.3-alpha",
    date: "2026-06-26",
    fixed: [
      "Creating an organization reliably makes you its owner.",
      "Broken links in the organizer pages.",
    ],
  },
  {
    version: "v0.5.2-alpha",
    date: "2026-06-25",
    fixed: [
      "The total charged at checkout is correct.",
      "Trying a payment again after it failed works.",
      "The payment result page shows the right outcome after you return from paying.",
      "Tournaments are grouped under the right dates.",
    ],
  },
  {
    version: "v0.5.1-alpha",
    date: "2026-06-23",
    improved: [
      "Payments are confirmed automatically as soon as our payment provider reports them.",
    ],
  },
  {
    version: "v0.5.0-alpha",
    date: "2026-06-23",
    improved: [
      "You see a confirmation after changing your password.",
      "After signing out you're taken back to the tournament list.",
    ],
    fixed: [
      "Signed-in users are no longer shown the sign-in and sign-up pages.",
    ],
  },
  {
    version: "v0.4.0-alpha",
    date: "2026-06-22",
    headline: "Profile photos and organizer tools.",
    new: [
      "Upload a profile photo.",
      "The organizer dashboard lists your tournaments with their status.",
      "Organizers can change a member's role or remove them.",
    ],
    improved: [
      "A redesigned profile page.",
      "Password requirements are easier to read on mobile.",
    ],
    fixed: [
      "Several sign-up, sign-in, sign-out and password reset problems, including “Keep me signed in”.",
    ],
  },
  {
    version: "v0.3.0-alpha",
    date: "2026-06-18",
    headline: "Create organizations and tournaments.",
    new: [
      "Pay your entry fee online when you register.",
      "Apply to set up an organization, and invite members once it's approved.",
      "Organizers can create tournaments with a step-by-step editor.",
      "A profile page where you can view and edit your chess details.",
      "A page explaining how to become an organizer.",
    ],
    improved: [
      "Signing up is split into clear steps: account, email verification, then profile.",
      "Tournaments are grouped by date, with past ones dimmed.",
    ],
  },
  {
    version: "v0.2.2-alpha",
    date: "2026-05-20",
    silent: true,
    fixed: ["Small display fixes."],
  },
  {
    version: "v0.2.1-alpha",
    date: "2026-05-19",
    headline: "Register for tournaments.",
    new: [
      "Register for a tournament, with eligibility checked for you.",
      "My Tournaments lists everything you've registered for.",
      "Apply to become an organizer.",
      "Tournament pages have tabs, including the starting rank.",
      "Read the Terms and Privacy Policy while signing up.",
      "A footer on every page, and a friendlier page for links that don't exist.",
    ],
    improved: [
      "The register button tells you when registration has closed or you're already registered.",
    ],
    fixed: ["Your email stays filled in after a failed sign-in."],
  },
  {
    version: "v0.2.0-alpha",
    date: "2026-05-10",
    headline: "Browse tournaments.",
    new: [
      "Browse upcoming tournaments, filter by date, and open each one for details.",
      "Sign up, sign in, reset your password and sign out.",
      "A navigation menu that works on mobile.",
      "Sharing a tournament link shows a preview.",
    ],
    improved: ["The home page loads much faster."],
    fixed: ["The date filter shows the right tournaments."],
  },
  {
    version: "v0.1.3-alpha",
    date: "2026-03-01",
    silent: true,
    improved: ["Behind-the-scenes improvements."],
  },
  {
    version: "v0.1.2-alpha",
    date: "2026-02-28",
    silent: true,
    improved: [
      "Groundwork for accounts.",
      "Old site addresses redirect to mychesstour.com.",
    ],
  },
  {
    version: "v0.1.1-alpha",
    date: "2026-02-27",
    silent: true,
    improved: ["Small improvements."],
  },
  {
    version: "v0.1.0-alpha",
    date: "2026-02-27",
    headline: "MY Chess Tour is coming.",
    new: [
      "Join the waitlist to hear when we launch.",
      "A progress bar shows how close we are.",
    ],
  },
];
