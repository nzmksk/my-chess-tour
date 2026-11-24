import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetClaim, mockClient } = vi.hoisted(() => ({
  mockGetClaim: vi.fn(),
  mockClient: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));
vi.mock("@/services/guardianship/account-claims", () => ({
  getAccountClaimByToken: mockGetClaim,
}));
vi.mock("@/app/claim/[token]/_components/ClaimClient", () => ({
  default: mockClient,
}));

import AccountClaimPage, { metadata } from "../page";

const TOKEN = "T".repeat(43);

function clientProps(tree: unknown) {
  const root = tree as { props: { children: Array<{ props: unknown }> } };
  return root.props.children[1].props as Record<string, unknown>;
}

describe("AccountClaimPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("passes the client what it shows, never the token hash", async () => {
    mockGetClaim.mockResolvedValue({
      tokenHash: "h".repeat(64),
      state: "pending",
      email: "ada@example.com",
      expiresAt: "2026-11-27T12:00:00Z",
      playerFirstName: "Ada",
      playerLastName: "Adult",
      guardianName: "Gwen Guardian",
    });
    const tree = await AccountClaimPage({
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(mockGetClaim).toHaveBeenCalledWith(TOKEN);
    expect(clientProps(tree)).toEqual({
      token: TOKEN,
      loadFailed: false,
      claim: {
        state: "pending",
        email: "ada@example.com",
        playerFirstName: "Ada",
        guardianName: "Gwen Guardian",
      },
    });
  });

  it("reports a failed lookup", async () => {
    mockGetClaim.mockRejectedValue(new Error("db down"));
    const tree = await AccountClaimPage({
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(clientProps(tree)).toMatchObject({ claim: null, loadFailed: true });
  });

  it("keeps the page out of search results and referrers", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});
