import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { tournamentBuilder, mockFrom, mockAuthorize, mockLoadRoster } =
  vi.hoisted(() => {
    const tournamentBuilder: Record<string, unknown> & {
      result: { data: unknown; error: unknown };
    } = { result: { data: null, error: null } };
    for (const m of ["select", "eq", "single"]) {
      tournamentBuilder[m] = vi.fn(() => tournamentBuilder);
    }
    tournamentBuilder.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(tournamentBuilder.result).then(onfulfilled, onrejected);

    return {
      tournamentBuilder,
      mockFrom: vi.fn(() => tournamentBuilder),
      mockAuthorize: vi.fn(),
      mockLoadRoster: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("../../../_lib/authorize", () => ({
  authorizeTournamentManager: mockAuthorize,
}));

vi.mock("@/services/registrations/roster", () => ({
  loadRoster: mockLoadRoster,
}));

import { GET } from "../route";

const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";

const TOURNAMENT = {
  id: TOUR_ID,
  name: "KL Rapid Open 2026",
  slug: "kl-rapid-open-2026",
  timezone: "Asia/Kuala_Lumpur",
  format: { type: "rapid", system: "swiss", rounds: 7 },
};

const ENTRIES = [
  {
    index: 1,
    registration_id: "r1",
    user_id: "u1",
    first_name: "Alice",
    last_name: "Tan, Jr.",
    title: "WFM",
    gender: "female",
    date_of_birth: "2008-03-14",
    nationality: "MY",
    is_oku: true,
    fide_id: 5701234,
    fide_rating: 1750,
    mcf_id: 1234,
    national_rating: 1690,
    fee_tier: "standard",
    status: "confirmed",
    // 10:30 in Kuala Lumpur (UTC+8).
    registered_at: "2026-11-01T02:30:00+00:00",
  },
  {
    index: 2,
    registration_id: "r2",
    user_id: "u2",
    first_name: "=cmd",
    last_name: "Lim",
    title: null,
    gender: null,
    date_of_birth: null,
    nationality: null,
    is_oku: false,
    fide_id: null,
    fide_rating: null,
    mcf_id: null,
    national_rating: null,
    fee_tier: "student_u18",
    status: "pending_payment",
    registered_at: "2026-11-02T16:05:00+00:00",
  },
];

function call(query = "") {
  const req = new NextRequest(
    `http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${TOUR_ID}/participants/export${query}`,
  );
  return GET(req, { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({ ok: true, userId: "u-admin" });
  tournamentBuilder.result = { data: TOURNAMENT, error: null };
  mockLoadRoster.mockResolvedValue({ ok: true, entries: ENTRIES });
});

describe("GET participants/export", () => {
  it("downloads the roster as CSV by default", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="kl-rapid-open-2026-participants.csv"',
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const csv = await res.text();
    // Response.text() drops the BOM; check the raw bytes for it separately.
    expect(csv.split("\r\n")).toEqual([
      "#,Title,First name,Last name,Gender,Date of birth,Nationality,OKU,FIDE ID,FIDE rating,MCF ID,National rating,Fee tier,Status,Registered (MYT)",
      '1,WFM,Alice,"Tan, Jr.",Female,2008-03-14,Malaysia,Yes,5701234,1750,1234,1690,Standard,Confirmed,2026-11-01 10:30',
      "2,,'=cmd,Lim,,,,No,,,,,Student U18,Pending payment,2026-11-03 00:05",
      "",
    ]);
  });

  it("starts the CSV with a UTF-8 BOM for Excel", async () => {
    const bytes = new Uint8Array(await (await call()).arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("downloads an Excel workbook with ?format=xlsx", async () => {
    const res = await call("?format=xlsx");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="kl-rapid-open-2026-participants.xlsx"',
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A ZIP: local file header signature "PK\3\4".
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("names the file after the tournament when it has no slug yet", async () => {
    tournamentBuilder.result = {
      data: { ...TOURNAMENT, slug: null, name: "Draft: Kejohanan Catur!" },
      error: null,
    };
    const res = await call();
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="draft-kejohanan-catur-participants.csv"',
    );
  });

  it("exports just the header when nobody has registered", async () => {
    mockLoadRoster.mockResolvedValue({ ok: true, entries: [] });
    const csv = await (await call()).text();
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("rates players by the tournament's format", async () => {
    await call();
    expect(mockLoadRoster).toHaveBeenCalledWith(TOUR_ID, "rapid");
  });

  it.each(["pdf", "toString", ""])(
    "rejects ?format=%j before touching anything",
    async (format) => {
      const res = await call(`?format=${format}`);
      expect(res.status).toBe(400);
      expect(mockAuthorize).not.toHaveBeenCalled();
    },
  );

  it("passes on the manager gate's refusal", async () => {
    mockAuthorize.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Access denied" } },
        { status: 403 },
      ),
    });

    const res = await call();
    expect(res.status).toBe(403);
    expect(mockAuthorize).toHaveBeenCalledWith(
      ORG_ID,
      TOUR_ID,
      "export participants",
    );
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockLoadRoster).not.toHaveBeenCalled();
  });

  it("scopes the tournament to the organization", async () => {
    await call();
    expect(tournamentBuilder.eq).toHaveBeenCalledWith("id", TOUR_ID);
    expect(tournamentBuilder.eq).toHaveBeenCalledWith(
      "organization_id",
      ORG_ID,
    );
  });

  it("returns 404 for a tournament outside the organization", async () => {
    tournamentBuilder.result = {
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    };
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockLoadRoster).not.toHaveBeenCalled();
  });

  it("returns 500 rather than a partial roster when loading fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadRoster.mockResolvedValue({
      ok: false,
      context: "users",
      error: { message: "db down" },
    });
    const res = await call();
    expect(res.status).toBe(500);
  });
});
