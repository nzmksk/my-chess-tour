import { describe, expect, it } from "vitest";
import {
  cleanText,
  codeBlock,
  issueBody,
  issueTitle,
  publicPath,
  reportReference,
  stripPathSecrets,
  toPathname,
  type IssueContext,
} from "../format";

const CONTEXT: IssueContext = {
  reference: "BR-1A2B3C4D",
  path: "/tournaments/kl-open-2026",
  userAgent: "Mozilla/5.0 (Test)",
  viewport: "390x844",
  appVersion: "0.10.0 (abc1234)",
  environment: "staging",
  reportedAt: "2026-11-18T10:00:00.000Z",
  signedIn: true,
  sentryEventId: null,
};

describe("cleanText", () => {
  it("strips controls, zero-width and bidi override characters", () => {
    expect(cleanText("a\u0000b​c‮d⁦e﻿")).toBe("abcde");
  });

  it("normalises newlines and collapses long runs of blank lines", () => {
    expect(cleanText("one\r\ntwo\rthree\n\n\n\n\n\nfour")).toBe(
      "one\ntwo\nthree\n\n\nfour",
    );
  });

  it("keeps tabs and trims surrounding whitespace", () => {
    expect(cleanText("  \ta\tb \n")).toBe("a\tb");
  });
});

describe("codeBlock", () => {
  it("uses a three-backtick fence for plain text", () => {
    expect(codeBlock("hello")).toBe("```text\nhello\n```");
  });

  it("uses a fence longer than any backtick run in the text", () => {
    const text = "before\n```\n@everyone <!-- hidden -->\n````\nafter";
    const block = codeBlock(text);
    expect(block.startsWith("`````text\n")).toBe(true);
    expect(block.endsWith("\n`````")).toBe(true);
  });
});

describe("issueTitle", () => {
  it("uses the first non-empty line", () => {
    expect(issueTitle("\n  Checkout spins forever  \nmore")).toBe(
      "[User report] Checkout spins forever",
    );
  });

  it("truncates a long first line", () => {
    const title = issueTitle("x".repeat(200));
    expect(title.length).toBe("[User report] ".length + 80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("breaks @mentions and #references", () => {
    const title = issueTitle("@nzmksk see #12");
    expect(title).not.toMatch(/@nzmksk/);
    expect(title).not.toMatch(/#12/);
    expect(title).toBe("[User report] @​nzmksk see #​12");
  });
});

describe("stripPathSecrets / publicPath", () => {
  const token = "Ab3_kL9-zzQwErTyUiOpAsDfGhJkLzXcVbNm1234567";

  it("masks an invitation token", () => {
    expect(stripPathSecrets(`/invitations/${token}`)).toBe(
      "/invitations/[token]",
    );
  });

  it("masks token-shaped segments on any route", () => {
    expect(stripPathSecrets(`/somewhere/${token}`)).toBe("/somewhere/[token]");
    expect(stripPathSecrets(`/x/${"a1".repeat(16)}`)).toBe("/x/[token]");
  });

  it("keeps tournament slugs", () => {
    expect(
      stripPathSecrets("/tournaments/kl-open-rapid-championship-2026"),
    ).toBe("/tournaments/kl-open-rapid-championship-2026");
  });

  it("keeps record ids privately but masks them publicly", () => {
    const path = "/profile/3f1c2a9e-1111-4222-8333-444455556666";
    expect(stripPathSecrets(path)).toBe(path);
    expect(publicPath(path)).toBe("/profile/[id]");
  });
});

describe("toPathname", () => {
  it("drops the origin, query string and fragment", () => {
    expect(
      toPathname("https://mychesstour.com/auth/login?email=a@b.com#top"),
    ).toBe("/auth/login");
    expect(toPathname("/tournaments?state=Selangor")).toBe("/tournaments");
  });
});

describe("issueBody", () => {
  it("puts the reporter's text in code blocks and the context in a table", () => {
    const body = issueBody("It broke @someone", "Click register", CONTEXT);
    expect(body).toContain(
      "### What happened\n\n```text\nIt broke @someone\n```",
    );
    expect(body).toContain(
      "### Steps to reproduce / expected behaviour\n\n```text\nClick register\n```",
    );
    expect(body).toContain("| Reference | `BR-1A2B3C4D` |");
    expect(body).toContain("| Page | `/tournaments/kl-open-2026` |");
    expect(body).toContain("| Signed in | `yes` |");
  });

  it("leaves out the steps section and empty context rows", () => {
    const body = issueBody("It broke", null, {
      ...CONTEXT,
      userAgent: null,
      viewport: null,
    });
    expect(body).not.toContain("Steps to reproduce");
    expect(body).not.toContain("| Browser |");
    expect(body).not.toContain("| Viewport |");
    expect(body).not.toContain("| Sentry event |");
  });

  it("escapes pipes and backticks in context values", () => {
    const body = issueBody("x", null, {
      ...CONTEXT,
      userAgent: "Evil | `UA`",
    });
    expect(body).toContain("| Browser | `` Evil \\| `UA` `` |");
  });

  it("publishes the masked path", () => {
    const body = issueBody("x", null, {
      ...CONTEXT,
      path: "/profile/3f1c2a9e-1111-4222-8333-444455556666",
    });
    expect(body).toContain("| Page | `/profile/[id]` |");
    expect(body).not.toContain("3f1c2a9e");
  });
});

describe("reportReference", () => {
  it("is BR- and the first eight hex digits, uppercased", () => {
    expect(reportReference("1a2b3c4d-0000-4000-8000-000000000000")).toBe(
      "BR-1A2B3C4D",
    );
  });
});
