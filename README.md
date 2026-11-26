# MY Chess Tour

The coming-soon landing page for [MY Chess Tour](https://www.mychesstour.com), Malaysia's chess tournament hub. Visitors can join the waitlist and see build progress.

## Stack

- Next.js (App Router, TypeScript) with Tailwind CSS v4
- Supabase (Postgres) for the waitlist table
- GitHub API (`@octokit/rest`) for the build-progress bar
- Deployed on Netlify

## Getting started

```bash
npm ci
npm run dev
```

Create `.env.local` with:

| Variable                          | Purpose                                    |
| --------------------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase project URL                       |
| `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY` | Supabase publishable key                   |
| `GITHUB_TOKEN`                    | Optional; raises the GitHub API rate limit |

## Database

`db/migrations/001_waitlist.sql` creates the `waitlist` table.

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run lint`: ESLint
- `npm test`: unit tests (Vitest)
- `npm run test:coverage`: unit tests with coverage thresholds
