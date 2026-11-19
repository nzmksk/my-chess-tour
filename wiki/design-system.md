# MY Chess Tour — Design System

> **Version:** 1.2
> **Last updated:** 19 November 2026
> **Scope:** Web UI, transactional emails, and marketing communications
>
> **Source of truth for the web UI:** `src/styles/globals.css`. The values below were brought in
> line with it in v1.2. Where this page and the stylesheet disagree, the stylesheet wins; fix the
> page.

---

## 1. Brand Identity

MY Chess Tour is Malaysia's premier competitive chess circuit. The visual identity draws from the classical tradition of chess — regal, precise, and timeless — expressed through a dark luxury palette, gold accents, and refined serif typography. Every surface should feel like it belongs in a grand tournament hall.

**Core brand values:** Prestige · Precision · Heritage · Community

### How it is implemented

- **Tailwind CSS v4.** The tokens are `@theme` variables in `src/styles/globals.css`, so each one is also a utility class: `--color-bg-surface` → `bg-bg-surface`, `--color-gold-bright` → `text-gold-bright` / `border-gold-bright`, `--font-cinzel` → `font-cinzel`. Prefer the utility over a hand-written `var(...)`.
- **Two themes.** Dark is the default (`<html data-theme="dark">`). `[data-theme="light"]` redefines the same tokens, so components never branch on the theme. `ThemeToggle` saves the choice in `localStorage` under `theme`, and an inline script in `src/app/layout.tsx` applies it before first paint. Tailwind's `dark:` variant follows `data-theme`, not the OS setting.
- **Shared component classes** live in the stylesheet's `@layer components`: buttons (`.btn-primary`, `.btn-secondary`, `.btn-gold`, `.btn-danger`), `.card`, form controls (`.input`, `.input-label`, `.checkbox`), `.modal`, badges (`.badge-fide`, `.badge-mcf`, `.badge-format`, …), banners (`.error-banner`, `.info-banner`, `.success-banner`), navigation (`.nav-*`), the wizard step tracker (`.step-*`) and `.skeleton-shimmer`.
- **Primitives** (`src/components/ui/`: button, dialog, popover, command, country dropdown) follow the shadcn/Radix pattern. Their semantic names (`--background`, `--primary`, `--muted`, …) are mapped onto the brand tokens in the stylesheet's `@theme inline` block.
- **Emails** don't use any of this: they are standalone HTML with inline styles and the dark palette in px ([§6](#6-email-templates)).

---

## 2. Color Palette

All colors are `@theme` tokens in `src/styles/globals.css`. The dark values (the default theme) are:

```css
@theme {
  /* ── Backgrounds ── */
  --color-bg-base: #0f0f0f; /* Page / outermost background */
  --color-bg-surface: #1c1c1c; /* Cards, panels */
  --color-bg-raised: #282828; /* Slightly elevated surfaces */
  --color-bg-sunken: #080808; /* Headers, footers, recessed areas */

  /* ── Gold (Primary Accent) ── */
  --color-gold-bright: #c9a84c; /* Primary gold — borders, icons, key text */
  --color-gold-deep: #a07c2c; /* Gradient end, hover states */
  --color-gold-muted: #7a6e55; /* Subtext, meta labels */
  --color-gold-dim: #5a5040; /* Disabled, placeholder text */
  --color-gold-ghost: #2e2a1e; /* Subtle borders, dividers */

  /* ── Text ── */
  --color-text-primary: #e8d9b4; /* Headlines */
  --color-text-body: #d4c5a0; /* Body copy */
  --color-text-secondary: #a89878; /* Supporting text */
  --color-text-muted: #7a6e55; /* Captions, meta */
  --color-text-disabled: #4a4030; /* Footer copy, de-emphasised */

  /* ── Semantic ── */
  --color-border: #3a3020; /* Standard border */
  --color-border-gold: #c9a84c; /* Highlighted/active border */
  --color-int-gold-bg: rgba(201, 168, 76, 0.08); /* Hover / selected fill */
  --color-int-gold-border: rgba(201, 168, 76, 0.3);

  /* ── Status (each has -bg and -border companions) ── */
  --color-info: #7ea3d9;
  --color-purple: #c07fd0;
  --color-success: #5aaa7a;
  --color-warning: #c8883a;
  --color-danger: #e07060;

  /* ── Loading ── */
  --color-skeleton-base: #1c1c1c;
  --color-skeleton-highlight: #303030;
}
```

There are no separate link tokens: inline links use `text-gold-bright` (or `text-text-secondary` with an underline) and darken on hover.

### Light theme

`[data-theme="light"]` overrides the same names, so a component written against the tokens works in both themes. The main values:

| Token                                      | Dark                              | Light                                                 |
| ------------------------------------------ | --------------------------------- | ----------------------------------------------------- |
| `--color-bg-base`                          | `#0f0f0f`                         | `#f5f1ea`                                             |
| `--color-bg-surface`                       | `#1c1c1c`                         | `#ffffff`                                             |
| `--color-bg-sunken`                        | `#080808`                         | `#ebe5db`                                             |
| `--color-gold-bright`                      | `#c9a84c`                         | `#8a6e24` (darker, for contrast on light backgrounds) |
| `--color-text-primary`                     | `#e8d9b4`                         | `#1c1810`                                             |
| `--color-text-body`                        | `#d4c5a0`                         | `#3a3428`                                             |
| `--color-border`                           | `#3a3020`                         | `#d8d0c0`                                             |
| `--color-success` / `-warning` / `-danger` | `#5aaa7a` / `#c8883a` / `#e07060` | `#2d7a3e` / `#9a6820` / `#a03830`                     |

The light theme also defines a few error-UI tokens of its own (`--color-danger-text`, `--color-error-text`, `--color-error-banner-*`). Check both themes when adding a token: one defined only under `@theme` keeps its dark value in light mode.

### Usage guidelines

| Role                        | Token                                                |
| --------------------------- | ---------------------------------------------------- |
| Page background             | `--color-bg-base`                                    |
| Card / panel background     | `--color-bg-surface`                                 |
| Section header / footer     | `--color-bg-sunken`                                  |
| Primary CTA fill            | gradient `--color-gold-bright` → `--color-gold-deep` |
| Active borders & underlines | `--color-gold-bright`                                |
| H1 / H2                     | `--color-text-primary`                               |
| Body paragraphs             | `--color-text-body`                                  |
| Supporting / meta text      | `--color-text-secondary`                             |
| Borders                     | `--color-border`                                     |

**Never** place light text on `--color-bg-raised` without sufficient contrast. Always test with WCAG AA (4.5:1 for body, 3:1 for large text).

---

## 3. Typography

Both families are loaded with `next/font/google` in `src/app/layout.tsx` (Cinzel 400/600/700, Lato 300/400), self-hosted at build time, and exposed as the `font-cinzel` and `font-lato` utilities. `body` defaults to Lato; `h1`–`h3` default to Cinzel in the stylesheet's base layer.

| Role                         | Family | Weight  | Size                              | Letter-spacing     |
| ---------------------------- | ------ | ------- | --------------------------------- | ------------------ |
| Brand wordmark               | Cinzel | 700     | 22px (email) / 1.75–2.25rem (web) | 0.14em             |
| Page / section headings (H1) | Cinzel | 600     | 1.75–2rem                         | 0.05em             |
| Sub-headings (H2, H3)        | Cinzel | 400     | 1.125–1.375rem                    | 0.04em             |
| Body copy                    | Lato   | 300–400 | 0.9375–1rem                       | 0                  |
| UI labels / buttons          | Cinzel | 700     | 0.75–0.875rem                     | 0.15em (uppercase) |
| Captions / meta              | Lato   | 300     | 0.6875–0.75rem                    | 0.06–0.3em         |

### Rules

- Headings are **always** Cinzel. Body copy is **always** Lato.
- Button labels are Cinzel, uppercase, widely tracked.
- Never use bold Lato for display purposes — use Cinzel instead.
- Line-height for body: `1.7–1.8`. Headings: `1.1–1.2`.

---

## 4. Spacing & Layout

A base-8 rhythm keeps layouts consistent. There are no custom spacing tokens: use Tailwind's scale, which these steps map onto.

| Step | Value   | Tailwind | Usage                               |
| ---- | ------- | -------- | ----------------------------------- |
| xs   | 0.25rem | `1`      | Icon gap, tight inline spacing      |
| sm   | 0.5rem  | `2`      | Between small elements              |
| md   | 1rem    | `4`      | Component internal padding          |
| lg   | 1.5rem  | `6`      | Between sections within a component |
| xl   | 2.5rem  | `10`     | Card / panel padding                |
| 2xl  | 4rem    | `16`     | Page section separation             |

One custom breakpoint exists, `xs` (30rem), below Tailwind's `sm`.

**Max content width:** 75rem (web), 560px (email).
**Gutter (web):** 1.5rem on mobile, 2.5rem on desktop.

### CSS unit guidelines

| Use case                                  | Unit          |
| ----------------------------------------- | ------------- |
| Font size                                 | `rem` or `em` |
| Layout spacing                            | `rem`         |
| Borders, border-radius                    | `px`          |
| Icons, decorative strip heights           | `px`          |
| Fine adjustments (shadows, small offsets) | `px`          |
| Component scaling                         | `%` / `rem`   |

> **Email templates:** use `px` throughout — email clients do not reliably support `rem` or CSS custom properties.

---

## 5. Component Styles

### 5.1 Buttons

```css
/* Primary CTA */
.btn-primary {
  background: linear-gradient(
    135deg,
    var(--color-gold-bright),
    var(--color-gold-deep)
  );
  color: #0e0e0e;
  font-family: "Cinzel", serif;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 0.875rem 2.25rem;
  border-radius: 2px;
  border: none;
  box-shadow: 0 4px 20px rgba(201, 168, 76, 0.25);
  cursor: pointer;
  transition:
    box-shadow 0.2s ease,
    opacity 0.2s ease;
}
.btn-primary:hover {
  box-shadow: 0 6px 28px rgba(201, 168, 76, 0.4);
  opacity: 0.92;
}

/* Secondary / Ghost */
.btn-secondary {
  background: transparent;
  color: var(--color-gold-bright);
  font-family: "Cinzel", serif;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 0.8125rem 2.125rem;
  border-radius: 2px;
  border: 1px solid var(--color-gold-bright);
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}
.btn-secondary:hover {
  background: rgba(201, 168, 76, 0.08);
}
```

### 5.2 Cards / Panels

```css
.card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2.5rem;
}

/* Highlighted card with gold top accent */
.card--featured {
  border-top: 2px solid var(--color-gold-bright);
}
```

### 5.3 Divider

```css
.divider-gold {
  width: 3rem;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--color-gold-bright),
    transparent
  );
  margin: 0 auto 1.5rem;
  border: none;
}
```

### 5.4 Chessboard Strip (decorative)

Used as a top/bottom accent bar on emails and web section headers.

```css
.board-strip {
  display: flex;
  height: 8px; /* 4px for subtle / 8px for prominent */
}
.board-strip span {
  flex: 1;
}
.board-strip span:nth-child(odd) {
  background: var(--color-gold-bright);
}
.board-strip span:nth-child(even) {
  background: var(--color-bg-raised);
}
```

Use **16 `<span>` elements** inside `.board-strip` for a balanced pattern.

### 5.5 Navigation (Web)

```css
.nav {
  background: var(--color-bg-sunken);
  border-bottom: 1px solid var(--color-border);
  padding: 0 2.5rem;
  display: flex;
  align-items: center;
  height: 4rem;
}

.nav-logo {
  font-family: "Cinzel", serif;
  font-weight: 700;
  font-size: 1.125rem;
  letter-spacing: 0.14em;
  color: var(--color-gold-bright);
  text-transform: uppercase;
  text-decoration: none;
}

.nav-link {
  font-family: "Lato", sans-serif;
  font-size: 0.8125rem;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  text-decoration: none;
  padding: 0 1rem;
  transition: color 0.15s ease;
}
.nav-link:hover,
.nav-link.active {
  color: var(--color-gold-bright);
}
```

### 5.6 Form Inputs

```css
.input {
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border);
  border-radius: 2px;
  color: var(--color-text-body);
  font-family: "Lato", sans-serif;
  font-size: 0.9375rem;
  padding: 0.75rem 1rem;
  width: 100%;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}
.input:focus {
  border-color: var(--color-gold-bright);
  box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.1);
}
.input::placeholder {
  color: var(--color-text-disabled);
}

.input-label {
  font-family: "Cinzel", serif;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-gold-muted);
  display: block;
  margin-bottom: 6px;
}
```

### 5.7 Tables

```css
.table {
  width: 100%;
  border-collapse: collapse;
  font-family: "Lato", sans-serif;
  font-size: 0.875rem;
}
.table th {
  font-family: "Cinzel", serif;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-gold-muted);
  border-bottom: 1px solid var(--color-border-gold);
  padding: 0.625rem 1rem;
  text-align: left;
}
.table td {
  color: var(--color-text-body);
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border);
}
.table tr:hover td {
  background: rgba(201, 168, 76, 0.04);
}
```

### 5.8 Badges / Status Pills

```css
.badge {
  font-family: "Cinzel", serif;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 2px;
  display: inline-block;
}
.badge--gold {
  background: rgba(201, 168, 76, 0.15);
  color: var(--color-gold-bright);
  border: 1px solid rgba(201, 168, 76, 0.3);
}
.badge--neutral {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}
```

---

## 6. Email Templates

All email templates share the same structural shell. Use the following base layout, replacing only the `<!-- CONTENT -->` block.

### Base shell structure

```
[board-strip: 8px, 16 spans]
[header: bg #0a0a0a, border-bottom gold]
  ♔ logo icon
  Brand name (Cinzel 700)
  Tagline (Lato 300)
[body: bg #141414, padding 44px 40px]
  <!-- CONTENT -->
[footer: bg #0a0a0a, border-top #2e2a1e]
  [footer-board: 4px, 16 spans, muted]
  Legal / unsubscribe copy (Lato 300, 11px)
```

### Available email templates

All templates are in `src/services/email/templates/`. There are two kinds:

- **Sent by the app through Resend** (`src/services/email/email.ts`): `{{placeholder}}` values are substituted, HTML-escaped, by the sending function. These cover signup verification and password reset, registration confirmation, organizer application results, member invitations and their answers, OKU results, tournament cancellation and its review, bank-account verification, payouts and early-payout reviews, payout nominations, refunds, the prize pool (funding request, tournament listed, prize awarded, prize paid) and admin payout alerts. `src/services/email/__tests__/templates.test.ts` checks each one is complete.
- **Copies of Supabase Auth dashboard templates**, kept here for version control and not sent by the app: `change-email-address`, `invite-user`, `magic-link` and `reauthentication`. These use Supabase's Go-template tokens (`{{ .ConfirmationURL }}`, `{{ .Token }}`). Edit them here, then paste them into the dashboard.

Not built yet: tournament reminders.

### Email-specific rules

- Max width: **560px**. Always center in the email client viewport.
- Use inline styles **or** `<style>` in `<head>` — avoid external CSS.
- Use `px` for all sizes and spacing — email clients do not reliably support `rem` or CSS custom properties.
- A link (`{{ .ConfirmationURL }}` in a Supabase template, the URL placeholder in an app template) must appear in **both** the CTA button `href` and a plain-text fallback link.
- Emails keep the dark palette whatever theme the reader uses on the site.
- Chessboard strip at top: **8px tall**. Footer strip: **4px tall, muted** (`#2e2a1e` / `#0a0a0a`).
- CTA button: gradient gold, Cinzel, dark text (`#0e0e0e`), `border-radius: 2px`.
- Body copy: Lato 300, 15px, `color: #a89878`, `line-height: 1.75`.

---

## 7. Iconography & Chess Motifs

Use Unicode chess pieces as decorative glyphs. They render natively across all platforms with no image dependency.

| Piece          | Glyph | Recommended use                 |
| -------------- | ----- | ------------------------------- |
| King (white)   | ♔     | Logo / brand mark               |
| Queen (white)  | ♕     | Hero sections, premium features |
| Rook (white)   | ♖     | Structure / architecture pages  |
| Bishop (white) | ♗     | Strategy / tips content         |
| Knight (white) | ♘     | Events, dynamic content         |
| Pawn (white)   | ♙     | Community / players section     |

Render chess piece glyphs in `--color-gold-bright` at 36–52px for display use, or `--color-text-muted` at 16–20px for decorative watermarks.

---

## 8. Motion & Interaction

Keep animations purposeful and restrained — reinforcing prestige, not playfulness.

These are values to reuse, not tokens: none of them is defined as a CSS variable.

```css
/* Standard transition for interactive elements */
transition: 0.2s ease;

/* Gold glow on focus/hover */
box-shadow: 0 4px 20px rgba(201, 168, 76, 0.25); /* resting */
box-shadow: 0 6px 28px rgba(201, 168, 76, 0.4); /* hover */
```

- **Hover:** subtle opacity shift (`0.92`) or border-color change to gold. No scale transforms.
- **Focus rings:** `box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.15)` — no browser default outlines.
- **Page transitions:** fade-in at 200ms. No slide-in animations that could feel casual.
- **Loading states:** skeleton placeholders with the `.skeleton-shimmer` sweep (e.g. the tournament grid), or a thin gold progress bar for in-place actions.

---

## 9. Do's and Don'ts

| ✅ Do                                                           | ❌ Don't                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Use Cinzel for all headings and labels                          | Use system fonts (Arial, Inter, Roboto) for any branded surface   |
| Build every surface from the tokens, so it works in both themes | Hard-code a hex colour in a component (it breaks the light theme) |
| Use the gold gradient for primary CTAs only                     | Overuse gold — it loses its accent power                          |
| Add the chessboard strip as a branded separator                 | Use the strip more than twice per layout                          |
| Write button labels in Cinzel, ALL CAPS, tracked wide           | Use sentence case or lowercase on buttons                         |
| Test all email templates in dark-mode email clients             | Assume email clients render CSS as expected                       |
| Keep email max-width at 560px                                   | Exceed 600px on email containers                                  |

---

## 10. CSS Variables Quick Reference

The live definitions are in `src/styles/globals.css` (`@theme` for the dark default, `[data-theme="light"]` for the light theme); don't copy them elsewhere. The block below is the **email palette**, the original v1.1 values that the HTML email templates still use as inline px/hex values. The spacing, motion and font entries are reference values, not variables the web app defines.

```css
:root {
  /* Backgrounds */
  --color-bg-base: #0e0e0e;
  --color-bg-surface: #141414;
  --color-bg-raised: #1a1a1a;
  --color-bg-sunken: #0a0a0a;

  /* Gold accent */
  --color-gold-bright: #c9a84c;
  --color-gold-deep: #a07c2c;
  --color-gold-muted: #7a6e55;
  --color-gold-dim: #5a5040;
  --color-gold-ghost: #2e2a1e;

  /* Text */
  --color-text-primary: #e8d9b4;
  --color-text-body: #d4c5a0;
  --color-text-secondary: #a89878;
  --color-text-muted: #7a6e55;
  --color-text-disabled: #4a4030;

  /* Borders */
  --color-border: #2e2a1e;
  --color-border-gold: #c9a84c;

  /* Links */
  --color-link: #8a7040;
  --color-link-hover: #c9a84c;

  /* Spacing (rem — scales with root font size) */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --space-2xl: 4rem;

  /* Motion */
  --transition-base: 0.2s ease;

  /* Shadows (px — fine adjustments, not scaled) */
  --shadow-gold-sm: 0 4px 20px rgba(201, 168, 76, 0.25);
  --shadow-gold-md: 0 6px 28px rgba(201, 168, 76, 0.4);

  /* Typography */
  --font-display: "Cinzel", serif;
  --font-body: "Lato", sans-serif;
}
```

---

_MY Chess Tour Design System · Maintained by the MY Chess Tour product team_
