# MY Chess Tour — Design System

> **Version:** 1.0  
> **Last updated:** February 2026  
> **Scope:** Web UI, transactional emails, and marketing communications

---

## 1. Brand Identity

MY Chess Tour is Malaysia's premier competitive chess circuit. The visual identity draws from the classical tradition of chess — regal, precise, and timeless — expressed through a dark luxury palette, gold accents, and refined serif typography. Every surface should feel like it belongs in a grand tournament hall.

**Core brand values:** Prestige · Precision · Heritage · Community

---

## 2. Color Palette

All colors are defined as CSS custom properties to be declared on `:root`.

```css
:root {
  /* ── Backgrounds ── */
  --color-bg-base:      #0e0e0e;   /* Page / outermost background */
  --color-bg-surface:   #141414;   /* Cards, panels, email wrapper */
  --color-bg-raised:    #1a1a1a;   /* Slightly elevated surfaces */
  --color-bg-sunken:    #0a0a0a;   /* Headers, footers, recessed areas */

  /* ── Gold (Primary Accent) ── */
  --color-gold-bright:  #c9a84c;   /* Primary gold — borders, icons, key text */
  --color-gold-deep:    #a07c2c;   /* Gradient end, hover states */
  --color-gold-muted:   #7a6e55;   /* Subtext, meta labels */
  --color-gold-dim:     #5a5040;   /* Disabled, placeholder text */
  --color-gold-ghost:   #2e2a1e;   /* Subtle borders, dividers */

  /* ── Text ── */
  --color-text-primary:   #e8d9b4; /* Headlines */
  --color-text-body:      #d4c5a0; /* Body copy */
  --color-text-secondary: #a89878; /* Supporting text */
  --color-text-muted:     #7a6e55; /* Captions, meta */
  --color-text-disabled:  #4a4030; /* Footer copy, de-emphasised */

  /* ── Semantic ── */
  --color-border:       #2e2a1e;   /* Standard border */
  --color-border-gold:  #c9a84c;   /* Highlighted/active border */
  --color-link:         #8a7040;   /* Inline link */
  --color-link-hover:   #c9a84c;   /* Link hover */
}
```

### Usage guidelines

| Role | Token |
|---|---|
| Page background | `--color-bg-base` |
| Card / panel background | `--color-bg-surface` |
| Section header / footer | `--color-bg-sunken` |
| Primary CTA fill | gradient `--color-gold-bright` → `--color-gold-deep` |
| Active borders & underlines | `--color-gold-bright` |
| H1 / H2 | `--color-text-primary` |
| Body paragraphs | `--color-text-body` |
| Supporting / meta text | `--color-text-secondary` |
| Borders | `--color-border` |

**Never** place light text on `--color-bg-raised` without sufficient contrast. Always test with WCAG AA (4.5:1 for body, 3:1 for large text).

---

## 3. Typography

```css
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Lato:wght@300;400&display=swap');
```

| Role | Family | Weight | Size | Letter-spacing |
|---|---|---|---|---|
| Brand wordmark | Cinzel | 700 | 22px (email) / 28–36px (web) | 0.14em |
| Page / section headings (H1) | Cinzel | 600 | 28–32px | 0.05em |
| Sub-headings (H2, H3) | Cinzel | 400 | 18–22px | 0.04em |
| Body copy | Lato | 300–400 | 15–16px | 0 |
| UI labels / buttons | Cinzel | 700 | 12–14px | 0.15em (uppercase) |
| Captions / meta | Lato | 300 | 11–12px | 0.06–0.3em |

### Rules

- Headings are **always** Cinzel. Body copy is **always** Lato.
- Button labels are Cinzel, uppercase, widely tracked.
- Never use bold Lato for display purposes — use Cinzel instead.
- Line-height for body: `1.7–1.8`. Headings: `1.1–1.2`.

---

## 4. Spacing & Layout

A base-8 spacing scale keeps all layouts consistent.

| Token | Value | Usage |
|---|---|---|
| `--space-xs`  | 4px  | Icon gap, tight inline spacing |
| `--space-sm`  | 8px  | Between small elements |
| `--space-md`  | 16px | Component internal padding |
| `--space-lg`  | 24px | Between sections within a component |
| `--space-xl`  | 40px | Card / panel padding |
| `--space-2xl` | 64px | Page section separation |

**Max content width:** 1200px (web), 560px (email).  
**Gutter (web):** 24px on mobile, 40px on desktop.

---

## 5. Component Styles

### 5.1 Buttons

```css
/* Primary CTA */
.btn-primary {
  background: linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep));
  color: #0e0e0e;
  font-family: 'Cinzel', serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 14px 36px;
  border-radius: 2px;
  border: none;
  box-shadow: 0 4px 20px rgba(201, 168, 76, 0.25);
  cursor: pointer;
  transition: box-shadow 0.2s ease, opacity 0.2s ease;
}
.btn-primary:hover {
  box-shadow: 0 6px 28px rgba(201, 168, 76, 0.4);
  opacity: 0.92;
}

/* Secondary / Ghost */
.btn-secondary {
  background: transparent;
  color: var(--color-gold-bright);
  font-family: 'Cinzel', serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 13px 34px;
  border-radius: 2px;
  border: 1px solid var(--color-gold-bright);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
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
  padding: var(--space-xl);
}

/* Highlighted card with gold top accent */
.card--featured {
  border-top: 2px solid var(--color-gold-bright);
}
```

### 5.3 Divider

```css
.divider-gold {
  width: 48px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-gold-bright), transparent);
  margin: 0 auto var(--space-lg);
  border: none;
}
```

### 5.4 Chessboard Strip (decorative)

Used as a top/bottom accent bar on emails and web section headers.

```css
.board-strip {
  display: flex;
  height: 8px;          /* 4px for subtle / 8px for prominent */
}
.board-strip span { flex: 1; }
.board-strip span:nth-child(odd)  { background: var(--color-gold-bright); }
.board-strip span:nth-child(even) { background: var(--color-bg-raised); }
```

Use **16 `<span>` elements** inside `.board-strip` for a balanced pattern.

### 5.5 Navigation (Web)

```css
.nav {
  background: var(--color-bg-sunken);
  border-bottom: 1px solid var(--color-border);
  padding: 0 var(--space-xl);
  display: flex;
  align-items: center;
  height: 64px;
}

.nav-logo {
  font-family: 'Cinzel', serif;
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.14em;
  color: var(--color-gold-bright);
  text-transform: uppercase;
  text-decoration: none;
}

.nav-link {
  font-family: 'Lato', sans-serif;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  text-decoration: none;
  padding: 0 var(--space-md);
  transition: color 0.15s ease;
}
.nav-link:hover,
.nav-link.active { color: var(--color-gold-bright); }
```

### 5.6 Form Inputs

```css
.input {
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border);
  border-radius: 2px;
  color: var(--color-text-body);
  font-family: 'Lato', sans-serif;
  font-size: 15px;
  padding: 12px 16px;
  width: 100%;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.input:focus {
  border-color: var(--color-gold-bright);
  box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.1);
}
.input::placeholder { color: var(--color-text-disabled); }

.input-label {
  font-family: 'Cinzel', serif;
  font-size: 11px;
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
  font-family: 'Lato', sans-serif;
  font-size: 14px;
}
.table th {
  font-family: 'Cinzel', serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-gold-muted);
  border-bottom: 1px solid var(--color-border-gold);
  padding: 10px 16px;
  text-align: left;
}
.table td {
  color: var(--color-text-body);
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}
.table tr:hover td { background: rgba(201, 168, 76, 0.04); }
```

### 5.8 Badges / Status Pills

```css
.badge {
  font-family: 'Cinzel', serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 2px;
  display: inline-block;
}
.badge--gold    { background: rgba(201,168,76,0.15); color: var(--color-gold-bright); border: 1px solid rgba(201,168,76,0.3); }
.badge--neutral { background: rgba(255,255,255,0.05); color: var(--color-text-secondary); border: 1px solid var(--color-border); }
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

| Template | Supabase Trigger | File |
|---|---|---|
| Confirm signup | `confirm_signup` | [confirm-signup](./email-templates/confirm-signup.html) |
| Invite user | `invite_user` | [invite-user](./email-templates/invite-user.html) |
| Magic link / OTP | `magic_link` | [magic-link](./email-templates/magic-link.html) |
| Change email address | `change_email` | [change-email-address](./email-templates/change-email-address.html) |
| Reset password | `reset_password` | [reset-password](./email-templates/reset-password.html) |
| Reauthentication | `reauthentication` | [reauthentication](./email-templates/reauthentication.html) |
| Tournament registration | Custom | *(to be created)* |
| Match reminder | Custom | *(to be created)* |

### Email-specific rules

- Max width: **560px**. Always center in the email client viewport.
- Use inline styles **or** `<style>` in `<head>` — avoid external CSS.
- The `{{ .ConfirmationURL }}` token must appear in **both** the CTA button `href` and a plain-text fallback link.
- Chessboard strip at top: **8px tall**. Footer strip: **4px tall, muted** (`#2e2a1e` / `#0a0a0a`).
- CTA button: gradient gold, Cinzel, dark text (`#0e0e0e`), `border-radius: 2px`.
- Body copy: Lato 300, 15px, `color: #a89878`, `line-height: 1.75`.

---

## 7. Iconography & Chess Motifs

Use Unicode chess pieces as decorative glyphs. They render natively across all platforms with no image dependency.

| Piece | Glyph | Recommended use |
|---|---|---|
| King (white) | ♔ | Logo / brand mark |
| Queen (white) | ♕ | Hero sections, premium features |
| Rook (white) | ♖ | Structure / architecture pages |
| Bishop (white) | ♗ | Strategy / tips content |
| Knight (white) | ♘ | Events, dynamic content |
| Pawn (white) | ♙ | Community / players section |

Render chess piece glyphs in `--color-gold-bright` at 36–52px for display use, or `--color-text-muted` at 16–20px for decorative watermarks.

---

## 8. Motion & Interaction

Keep animations purposeful and restrained — reinforcing prestige, not playfulness.

```css
/* Standard transition for interactive elements */
--transition-base: 0.2s ease;

/* Gold glow on focus/hover */
--shadow-gold-sm: 0 4px 20px rgba(201, 168, 76, 0.25);
--shadow-gold-md: 0 6px 28px rgba(201, 168, 76, 0.40);
```

- **Hover:** subtle opacity shift (`0.92`) or border-color change to gold. No scale transforms.
- **Focus rings:** `box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.15)` — no browser default outlines.
- **Page transitions:** fade-in at 200ms. No slide-in animations that could feel casual.
- **Loading states:** a single pulsing gold dot or a thin gold progress bar at the top of the viewport.

---

## 9. Do's and Don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Use Cinzel for all headings and labels | Use system fonts (Arial, Inter, Roboto) for any branded surface |
| Keep backgrounds very dark (`#0e0e0e` to `#1a1a1a`) | Use white or light backgrounds except for print/export contexts |
| Use the gold gradient for primary CTAs only | Overuse gold — it loses its accent power |
| Add the chessboard strip as a branded separator | Use the strip more than twice per layout |
| Write button labels in Cinzel, ALL CAPS, tracked wide | Use sentence case or lowercase on buttons |
| Test all email templates in dark-mode email clients | Assume email clients render CSS as expected |
| Keep email max-width at 560px | Exceed 600px on email containers |

---

## 10. CSS Variables Quick Reference

Paste this block into your root stylesheet:

```css
:root {
  /* Backgrounds */
  --color-bg-base:     #0e0e0e;
  --color-bg-surface:  #141414;
  --color-bg-raised:   #1a1a1a;
  --color-bg-sunken:   #0a0a0a;

  /* Gold accent */
  --color-gold-bright: #c9a84c;
  --color-gold-deep:   #a07c2c;
  --color-gold-muted:  #7a6e55;
  --color-gold-dim:    #5a5040;
  --color-gold-ghost:  #2e2a1e;

  /* Text */
  --color-text-primary:   #e8d9b4;
  --color-text-body:      #d4c5a0;
  --color-text-secondary: #a89878;
  --color-text-muted:     #7a6e55;
  --color-text-disabled:  #4a4030;

  /* Borders */
  --color-border:      #2e2a1e;
  --color-border-gold: #c9a84c;

  /* Links */
  --color-link:        #8a7040;
  --color-link-hover:  #c9a84c;

  /* Spacing */
  --space-xs:  4px;
  --space-sm:  8px;
  --space-md:  16px;
  --space-lg:  24px;
  --space-xl:  40px;
  --space-2xl: 64px;

  /* Motion */
  --transition-base: 0.2s ease;
  --shadow-gold-sm:  0 4px 20px rgba(201, 168, 76, 0.25);
  --shadow-gold-md:  0 6px 28px rgba(201, 168, 76, 0.40);

  /* Typography */
  --font-display: 'Cinzel', serif;
  --font-body:    'Lato', sans-serif;
}
```

---

*MY Chess Tour Design System · Maintained by the MY Chess Tour product team*
