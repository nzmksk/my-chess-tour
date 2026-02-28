# MY Chess Tour — Project Roadmap

## Context

- **Team:** Solo developer
- **Pace:** ~10 hours/week (evenings & weekends)
- **Deadline:** No hard deadline — quality over speed
- **Estimated total:** 16–20 weeks (~4–5 months)

## Principles

1. **Vertical slices over horizontal layers.** Build a complete flow end-to-end before moving to the next, rather than building all the backend first and all the frontend later. This means you always have something demoable.
2. **Deploy from week 1.** Set up CI/CD immediately. Every push to `main` deploys to a staging URL. This catches integration issues early.
3. **Seed data early.** Create realistic seed data (fake tournaments, players, organizers) so you're always developing against something that looks real.
4. **Don't gold-plate.** Resist the urge to perfect each screen before moving on. Get the flow working, then polish in the final milestone.

---

## Milestone Overview

| # | Milestone | Weeks | What you'll have at the end |
|---|---|---|---|
| M0 | Project Setup | 1 | Repo, CI/CD, database, auth, deployed skeleton |
| M1 | Player: Browse & View | 2–3 | Public tournament listing and detail pages |
| M2 | Player: Register & Pay | 3–4 | Full registration flow with CHIP payment |
| M3 | Organizer: Apply & Dashboard | 2–3 | Organizer application and dashboard shell |
| M4 | Organizer: Create & Manage | 3–4 | Tournament creation wizard and participant management |
| M5 | Admin Panel | 2–3 | Application review, tournament oversight, transactions |
| M6 | Polish & Launch Prep | 2–3 | Bug fixes, responsive design, emails, seed organizers |

**Total: 15–21 weeks** (target ~18 weeks)

---

## Detailed Sprint Plan

### M0 — Project Setup (Week 1)

The most important week. Get the boring stuff out of the way so everything after this is product work.

**Tasks:**

- [x] Initialize Next.js project (App Router, TypeScript, Tailwind CSS)
- [x] Set up Supabase project (database, auth, storage bucket for posters)
- [x] Run database migrations — create all tables, indexes, constraints from the schema doc
- [x] Configure Supabase Auth (email/password, magic link)
- [x] Set up Supabase Row Level Security (RLS) policies for basic access control
- [x] Create auth middleware for Next.js (session extraction, route protection)
- [x] Build the permission helper functions (`requireOrgRole`, `requireAdmin`)
- [x] Deploy to Netlify — connect repo, configure environment variables
- [x] Verify deployment pipeline works (push → build → deploy)
- [x] Create seed script with realistic test data (5 organizers, 15 tournaments, 50 players, 200 registrations)
- [x] Set up domain
- [x] Create signup, login, and logout endpoints
- [x] Add workflows for CI, Claude Code, and automatic dependency updates

**Deliverable:** A deployed app at `staging.mychesstour.com` with auth working (signup, login, logout) and a seeded database.

**Est. hours:** 8–12

---

### M1 — Player: Browse & View (Weeks 2–4)

The player's first impression. This is also the public face of the platform — anyone can see this without logging in.

**Week 2 — Browse tournaments:**

- [ ] `GET /tournaments` API route with search, filtering, pagination
- [ ] Browse page layout: search bar, filter dropdowns (format, state, rating, date)
- [ ] Tournament card component (poster, name, date, venue, format badge, spots indicator)
- [ ] Empty states and loading skeletons
- [ ] Mobile-responsive card grid

**Week 3 — Tournament detail + player nav:**

- [ ] `GET /tournaments/:id` API route
- [ ] Detail page: poster, full info, entry fees with player-pays breakdown, prizes, restrictions, organizer info
- [ ] Top navigation bar (Tournaments, My Tournaments, Profile, Become an Organizer)
- [ ] Registration CTA button (links to register flow, or "Login to register" if not authenticated)

**Week 4 (buffer) — Polish and edge cases:**

- [ ] Filter state persistence in URL params (shareable filtered views)
- [ ] SEO: meta tags, Open Graph for tournament detail pages
- [ ] Test with seed data: verify all filter combinations work
- [ ] Performance: ensure tournament list query is fast with indexes

**Deliverable:** A public, browsable tournament directory that looks good and works on mobile. Anyone can discover and view tournaments.

**Est. hours:** 20–30

---

### M2 — Player: Register & Pay (Weeks 5–8)

The core money flow. This is the most critical milestone — if this doesn't work reliably, nothing else matters.

**Week 5 — Registration flow:**

- [ ] `POST /tournaments/:id/register` API route with fee tier validation
- [ ] Register page: fee tier selection with player-pays breakdown
- [ ] Server-side validation: eligibility checks (title, rating, age, deadline, capacity)
- [ ] Create registration + payment records in a transaction

**Week 6 — CHIP integration:**

- [ ] Set up CHIP sandbox account
- [ ] Integrate CHIP purchase creation API (create payment session, get redirect URL)
- [ ] Build return pages: success, failure, pending
- [ ] `POST /webhooks/chip` — webhook handler with signature verification
- [ ] Webhook logic: update payment + registration status, invalidate cache
- [ ] Idempotency handling (duplicate webhook calls)

**Week 7 — Player dashboard:**

- [ ] `GET /player/registrations` API route
- [ ] Dashboard page: list of registered tournaments with status badges
- [ ] Registration detail view: payment confirmation, tournament info
- [ ] `POST /player/registrations/:id/cancel` API route
- [ ] Cancellation flow UI

**Week 8 (buffer) — Payment edge cases:**

- [ ] Handle expired payments (CHIP timeout → cancel registration)
- [ ] Handle failed payments (retry option)
- [ ] Test the full flow end-to-end in CHIP sandbox: register → pay → confirm → see in dashboard
- [ ] Player profile page: view and edit chess details (FIDE ID, rating, etc.)

**Deliverable:** A player can browse, select a fee tier, pay via CHIP, and see their confirmed registration. The full revenue loop works.

**Est. hours:** 30–40

---

### M3 — Organizer: Apply & Dashboard (Weeks 9–11)

**Week 9 — Application flow:**

- [ ] "Become an Organizer" link in player nav and dashboard sidebar
- [ ] `POST /organizer/apply` API route
- [ ] Application form: org name, description, dynamic links, contact info, past tournament refs
- [ ] `GET /organizer/application` API route
- [ ] Pending status screen after submission
- [ ] Approved state: redirect to organizer dashboard

**Week 10 — Organizer dashboard shell:**

- [ ] Organizer layout: dark sidebar + content area (distinct from player UI)
- [ ] `GET /organizer/:orgId/dashboard` API route
- [ ] Dashboard: stats row (active tournaments, registrations, revenue, pending payouts)
- [ ] Tournament list table with status badges and manage buttons
- [ ] Verified checkmark icon for approved organizations
- [ ] Top nav with link back to "My Tournaments" (player dashboard)

**Week 11 (buffer) — Settings and members foundation:**

- [ ] `GET /organizer/:orgId/members` API route
- [ ] Members page: list members with role badges
- [ ] `POST /organizer/:orgId/members/invite` API route
- [ ] Invite flow: email input, role selector, send invite
- [ ] `PATCH /organizer/:orgId/members/:id` and `DELETE` routes
- [ ] Role change and remove member functionality

**Deliverable:** A player can apply to become an organizer, and once approved, they land on a functional dashboard. They can invite team members.

**Est. hours:** 20–30

---

### M4 — Organizer: Create & Manage (Weeks 12–15)

The most complex milestone. The tournament creation wizard has 5 steps and a lot of form logic.

**Week 12 — Wizard steps 1–3:**

- [ ] Wizard shell: step progress bar, navigation (back/next/save draft)
- [ ] Step 1 — Basic Info: name, description, poster upload (Supabase Storage), venue, state, address
- [ ] `POST /organizer/:orgId/upload` API route (file upload to Supabase Storage)
- [ ] Step 2 — Format & Schedule: format type/system/rounds, time control, dates, capacity, rated checkboxes, restrictions (dynamic rows)
- [ ] Step 3 — Entry Fees: standard fee (fixed), additional tiers (early bird + date, titled + title checkboxes, rating range, age range), net breakdown with commission display

**Week 13 — Wizard steps 4–5 + save:**

- [ ] Step 4 — Prizes: dynamic categories with dynamic prize rows, special prizes section
- [ ] Step 5 — Review: read-only summary with edit buttons per section
- [ ] `POST /organizer/:orgId/tournaments` API route (save as draft)
- [ ] `PATCH /organizer/:orgId/tournaments/:id` API route (update)
- [ ] `POST /organizer/:orgId/tournaments/:id/publish` API route
- [ ] Form state management: persist wizard state across steps, handle save as draft at any point

**Week 14 — Tournament management:**

- [ ] `GET /organizer/:orgId/tournaments/:id` management view
- [ ] Participants tab: searchable, sortable table with player details, fee tier, status
- [ ] `GET /organizer/:orgId/tournaments/:id/participants` API route
- [ ] `GET /organizer/:orgId/tournaments/:id/participants/export` CSV/Excel export
- [ ] Registration stats tab with stats row and breakdown by fee tier
- [ ] `POST .../close-registration` and `POST .../cancel` actions

**Week 15 — Payouts:**

- [ ] `GET /organizer/:orgId/payouts` API route
- [ ] Payouts page: per-tournament payout cards with status
- [ ] Completed payouts: show payment date and reference
- [ ] Pending payouts: show estimated amount and completion note
- [ ] Commission model note ("charged to player, not deducted from you")

**Deliverable:** An organizer can create a tournament through the full wizard, publish it, monitor registrations, export participant lists, and track their payouts.

**Est. hours:** 30–40

---

### M5 — Admin Panel (Weeks 16–18)

By this point, the player and organizer flows are complete. The admin panel is mostly read-only views with a few actions.

**Week 16 — Dashboard and applications:**

- [ ] Admin layout: dark sidebar distinct from organizer
- [ ] `GET /admin/dashboard` API route
- [ ] Dashboard: stats, commission tracking, registration chart (use Recharts), quick-access panels
- [ ] `GET /admin/applications` API route
- [ ] Applications list: tabs (pending/approved/rejected/all), searchable table

**Week 17 — Application review and tournaments:**

- [ ] `GET /admin/applications/:id` detail view
- [ ] Review page: org details, links, past refs, applicant account info
- [ ] `POST /admin/applications/:id/approve` and `/reject` API routes
- [ ] Approve/reject actions with inline rejection reason panel
- [ ] `GET /admin/tournaments` API route (search indexes name + organizer)
- [ ] Tournaments page: full-width search, status checkbox filter, table with commission column

**Week 18 — Transactions:**

- [ ] `GET /admin/transactions` and `/stats` API routes
- [ ] Transactions page: stats row, search bar, table with full payment breakdown
- [ ] Refunded row styling (strikethrough)
- [ ] CHIP reference display for reconciliation

**Deliverable:** Admin can review organizer applications, monitor all tournaments and financial activity across the platform.

**Est. hours:** 20–30

---

### M6 — Polish & Launch Prep (Weeks 19–21)

**Week 19 — Responsive design and UX polish:**

- [ ] Test every page on mobile (375px), tablet (768px), desktop (1280px+)
- [ ] Fix layout issues, overflow, touch targets
- [ ] Add loading states and skeletons to all pages
- [ ] Add error boundaries and user-friendly error messages
- [ ] Empty state illustrations for zero-data pages

**Week 20 — Emails and notifications:**

- [ ] Set up transactional email (Resend or Supabase email)
- [ ] Registration confirmation email (tournament name, date, fee paid)
- [ ] Organizer application status email (approved/rejected with reason)
- [ ] Member invitation email
- [ ] Payment receipt email

**Week 21 — Launch prep:**

- [ ] Switch CHIP from sandbox to production
- [ ] Set up custom domain and SSL
- [ ] Set up error monitoring (Sentry free tier)
- [ ] Set up basic analytics (Plausible or Umami, privacy-friendly)
- [ ] Create the admin account
- [ ] Onboard 1–2 organizers: help them list their first real tournament
- [ ] Smoke test the full flow with a real (small) payment
- [ ] Write a simple landing/about page explaining what the platform does

**Deliverable:** Production-ready platform with real organizers and tournaments listed. Ready for soft launch.

**Est. hours:** 20–30

---

## Timeline Visualization

```
Week  1  ████ M0: Setup
Week  2  ████████ M1: Browse & View
Week  3  ████████
Week  4  ████████
Week  5  ██████████ M2: Register & Pay
Week  6  ██████████
Week  7  ██████████
Week  8  ██████████
Week  9  ████████ M3: Organizer Apply & Dashboard
Week 10  ████████
Week 11  ████████
Week 12  ██████████ M4: Organizer Create & Manage
Week 13  ██████████
Week 14  ██████████
Week 15  ██████████
Week 16  ████████ M5: Admin Panel
Week 17  ████████
Week 18  ████████
Week 19  ████████ M6: Polish & Launch
Week 20  ████████
Week 21  ████████
```

**Estimated total: ~150–200 hours over 18–21 weeks**

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CHIP integration complexity | Medium | High | Start sandbox testing in M2 week 1. CHIP has good docs and Malaysian support. |
| Scope creep on wizard forms | High | Medium | Stick to the wireframe exactly. No extra fields or "nice to have" validations. |
| Burnout at 10hrs/week | Medium | High | Buffer weeks built into every milestone. Skip a week if needed — no deadline. |
| Supabase RLS complexity | Medium | Medium | Start simple: basic policies in M0, refine as each feature is built. |
| Mobile responsiveness debt | Medium | Low | Test on mobile every milestone, not just at the end. |

---

## Definition of "Launch Ready"

The MVP is ready to soft-launch when ALL of these are true:

- [ ] A player can browse, view, register, pay, and see their registration — end to end
- [ ] An organizer can apply, get approved, create a tournament, publish it, and see registrations come in
- [ ] An admin can approve organizers and monitor platform activity
- [ ] Payments work in CHIP production (tested with a real small transaction)
- [ ] All pages are usable on mobile
- [ ] Transactional emails are sent (registration confirmation, application status)
- [ ] At least 1 real organizer has listed a real upcoming tournament
- [ ] Error monitoring is active

---

## Post-Launch Priorities (Not in MVP)

Once the platform is live and collecting feedback, these are the most likely next features in rough priority order:

1. **Player search & public profiles** — Let players find each other, show tournament history
2. **Organizer analytics** — Registration trends, revenue charts, repeat player tracking
3. **Refund self-service** — Let organizers process refunds directly instead of manual
4. **Google OAuth** — Reduce signup friction
5. **Tournament results & standings** — Post-tournament results page
6. **Email marketing** — Notify players about new tournaments matching their preferences
7. **Multi-currency** — Support SGD, THB for SEA expansion
8. **Subscription plans** — Premium features for power organizers
