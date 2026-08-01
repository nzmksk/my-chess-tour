import { describe, expect, it } from "vitest";
import {
  checkRestrictions,
  checkFeeTierEligibility,
  checkRatedRequirements,
  normalizeRestrictions,
} from "../validators";
import type { EligibilityProfile, FeeTier } from "../validators";
import type { RatingContext } from "@/app/tournaments/utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-05-12T00:00:00Z");

// Which rating list a check reads. A FIDE-rated event is judged on the FIDE
// list for its format and an MCF-rated one on the national rating, with no
// substitution between them; an event rated by neither takes whichever the
// player has.
const FIDE = (formatType: string): RatingContext => ({
  formatType,
  isFideRated: true,
  isMcfRated: false,
});
const MCF = (formatType: string): RatingContext => ({
  formatType,
  isFideRated: false,
  isMcfRated: true,
});
const UNRATED_EVENT = (formatType: string): RatingContext => ({
  formatType,
  isFideRated: false,
  isMcfRated: false,
});

// At NOW, DOB_18 yields age 18, DOB_17 yields age 17
const DOB_18 = "2008-05-12";
const DOB_17 = "2008-05-13";

function makeProfile(
  overrides: Partial<EligibilityProfile> = {},
): EligibilityProfile {
  return {
    date_of_birth: null,
    gender: "male",
    oku_status: "none",
    title: null,
    fide_rating: null,
    national_rating: null,
    fide_id: null,
    mcf_id: null,
    nationality: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeRestrictions
// ---------------------------------------------------------------------------

describe("normalizeRestrictions", () => {
  it("returns null for null input", () => {
    expect(normalizeRestrictions(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeRestrictions(undefined)).toBeNull();
  });

  it("passes through a flat object unchanged", () => {
    const flat = { min_rating: 1000, max_rating: 1800 };
    expect(normalizeRestrictions(flat)).toEqual(flat);
  });

  it("returns null for an empty object", () => {
    expect(normalizeRestrictions({})).toBeNull();
  });

  it("returns null for an object whose fields are all null", () => {
    const empty = {
      min_rating: null,
      max_rating: null,
      min_age: null,
      max_age: null,
      gender: null,
      nationality: null,
      titles: [],
    };
    expect(normalizeRestrictions(empty)).toBeNull();
  });

  it("converts array rating restriction to flat format", () => {
    const raw = [{ type: "rating", max: 1799 }];
    expect(normalizeRestrictions(raw)).toEqual({ max_rating: 1799 });
  });

  it("converts array age restriction to flat format", () => {
    const raw = [{ type: "age", max: 18 }];
    expect(normalizeRestrictions(raw)).toEqual({ max_age: 18 });
  });

  it("converts array gender restriction to flat format", () => {
    const raw = [{ type: "gender", value: "female" }];
    expect(normalizeRestrictions(raw)).toEqual({ gender: "female" });
  });

  it("merges multiple restriction types from an array", () => {
    const raw = [
      { type: "rating", max: 1799 },
      { type: "age", max: 20 },
    ];
    expect(normalizeRestrictions(raw)).toEqual({
      max_rating: 1799,
      max_age: 20,
    });
  });

  it("maps both min and max for rating and age", () => {
    const raw = [
      { type: "rating", min: 1000, max: 1799 },
      { type: "age", min: 16, max: 20 },
    ];
    expect(normalizeRestrictions(raw)).toEqual({
      min_rating: 1000,
      max_rating: 1799,
      min_age: 16,
      max_age: 20,
    });
  });

  it("normalizes a nationality restriction", () => {
    const raw = [{ type: "nationality", value: "Malaysia" }];
    expect(normalizeRestrictions(raw)).toEqual({ nationality: "Malaysia" });
  });

  it("ignores unknown restriction types (e.g. state)", () => {
    const raw = [{ type: "state", value: "Selangor" }];
    expect(normalizeRestrictions(raw)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(normalizeRestrictions([])).toBeNull();
  });

  it("handles combined seed-style restrictions", () => {
    const raw = [
      { type: "nationality", value: "Malaysia" },
      { type: "age", max: 20 },
    ];
    expect(normalizeRestrictions(raw)).toEqual({
      nationality: "Malaysia",
      max_age: 20,
    });
  });
});

// ---------------------------------------------------------------------------
// checkRestrictions
// ---------------------------------------------------------------------------

describe("checkRestrictions", () => {
  describe("nationality restriction", () => {
    it("returns null when the player's nationality matches (by full name)", () => {
      expect(
        checkRestrictions(
          { nationality: "Malaysia" },
          makeProfile({ nationality: "Malaysia" }),
          FIDE("rapid"),
          NOW,
        ),
      ).toBeNull();
    });

    it("matches across formats (restriction 'MY' vs profile 'Malaysia')", () => {
      expect(
        checkRestrictions(
          { nationality: "MY" },
          makeProfile({ nationality: "Malaysia" }),
          FIDE("rapid"),
          NOW,
        ),
      ).toBeNull();
    });

    it("returns 422 ELIGIBILITY_ERROR when the nationality does not match", async () => {
      const result = checkRestrictions(
        { nationality: "Malaysia" },
        makeProfile({ nationality: "Singapore" }),
        FIDE("rapid"),
        NOW,
      );
      expect(result?.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      expect(json.error.message).toMatch(/Malaysia/);
    });

    it("returns 422 VALIDATION_ERROR when the player's nationality is missing", async () => {
      const result = checkRestrictions(
        { nationality: "Malaysia" },
        makeProfile({ nationality: null }),
        FIDE("rapid"),
        NOW,
      );
      expect(result?.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("gender restriction", () => {
    it("returns 422 when tournament is female-only and player is male", async () => {
      const result = checkRestrictions(
        { gender: "female" },
        makeProfile({ gender: "male" }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      expect(json.error.message).toContain("female");
    });

    it("returns null when tournament is female-only and player is female", () => {
      const result = checkRestrictions(
        { gender: "female" },
        makeProfile({ gender: "female" }),
        FIDE("rapid"),
        NOW,
      );
      expect(result).toBeNull();
    });

    it("returns 422 when profile is null and gender restriction is set", async () => {
      const result = checkRestrictions(
        { gender: "female" },
        null,
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
    });
  });

  describe("no active restrictions", () => {
    it("returns null when all restriction fields are null", () => {
      const result = checkRestrictions(
        { min_rating: null, max_rating: null, min_age: null, max_age: null },
        makeProfile(),
        FIDE("rapid"),
        NOW,
      );
      expect(result).toBeNull();
    });

    it("returns null for empty restrictions object", () => {
      expect(
        checkRestrictions({}, makeProfile(), FIDE("rapid"), NOW),
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Title
  // -------------------------------------------------------------------------

  describe("title restriction", () => {
    it("returns null when player has a matching title", () => {
      const result = checkRestrictions(
        { titles: ["GM", "IM"] },
        makeProfile({ title: "GM" }),
        FIDE("rapid"),
        NOW,
      );
      expect(result).toBeNull();
    });

    it("returns 422 when player has no title and tournament requires titles", async () => {
      const result = checkRestrictions(
        { titles: ["GM", "IM"] },
        makeProfile({ title: null }),
        FIDE("rapid"),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("ELIGIBILITY_ERROR");
    });

    it("returns 422 when player's title is not in the allowed list", async () => {
      const result = checkRestrictions(
        { titles: ["GM", "IM"] },
        makeProfile({ title: "FM" }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.message).toContain("GM, IM");
    });
  });

  // -------------------------------------------------------------------------
  // Rating
  // -------------------------------------------------------------------------

  describe("rating restriction", () => {
    it("returns null when player rating is within min/max range", () => {
      const result = checkRestrictions(
        { min_rating: 1000, max_rating: 1800 },
        makeProfile({ fide_rating: { rapid: 1500 } }),
        FIDE("rapid"),
        NOW,
      );
      expect(result).toBeNull();
    });

    it("returns 422 when player FIDE rapid rating is below min_rating", async () => {
      const result = checkRestrictions(
        { min_rating: 1800 },
        makeProfile({ fide_rating: { rapid: 1600 } }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      expect(json.error.message).toContain("1800");
    });

    it("returns 422 when player has no rating and min_rating is set", async () => {
      const result = checkRestrictions(
        { min_rating: 1800 },
        makeProfile({ fide_rating: null, national_rating: null }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
    });

    it("returns 422 when player FIDE rating exceeds max_rating", async () => {
      const result = checkRestrictions(
        { max_rating: 1500 },
        makeProfile({ fide_rating: { rapid: 1800 } }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      expect(json.error.message).toContain("1500");
    });

    it("returns null when player has no rating and only max_rating is set", () => {
      const result = checkRestrictions(
        { max_rating: 1500 },
        makeProfile({ fide_rating: null, national_rating: null }),
        FIDE("rapid"),
        NOW,
      );
      expect(result).toBeNull();
    });

    it("does not substitute national_rating on a FIDE-rated tournament", async () => {
      const result = checkRestrictions(
        { min_rating: 1800 },
        makeProfile({ fide_rating: null, national_rating: 1900 }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
    });

    it("does not substitute another FIDE list for the format's own", async () => {
      const result = checkRestrictions(
        { min_rating: 1800 },
        makeProfile({ fide_rating: { standard: 1900 } }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
    });

    it("reads the national rating on an MCF-rated tournament", () => {
      const result = checkRestrictions(
        { min_rating: 1800 },
        makeProfile({ fide_rating: { rapid: 1500 }, national_rating: 1900 }),
        MCF("rapid"),
        NOW,
      );
      expect(result).toBeNull();
    });

    it("accepts either rating when the tournament is rated by neither federation", () => {
      expect(
        checkRestrictions(
          { min_rating: 1800 },
          makeProfile({ fide_rating: null, national_rating: 1900 }),
          UNRATED_EVENT("rapid"),
          NOW,
        ),
      ).toBeNull();

      expect(
        checkRestrictions(
          { min_rating: 1800 },
          makeProfile({ fide_rating: { rapid: 1900 }, national_rating: null }),
          UNRATED_EVENT("rapid"),
          NOW,
        ),
      ).toBeNull();
    });

    it("uses the blitz key for blitz format tournaments", async () => {
      const result = checkRestrictions(
        { min_rating: 1800 },
        makeProfile({
          fide_rating: { standard: 2000, rapid: 2000, blitz: 1600 },
        }),
        FIDE("blitz"),
        NOW,
      );
      expect(result!.status).toBe(422);
    });

    it("uses the standard key for classical format tournaments", () => {
      const result = checkRestrictions(
        { min_rating: 1800 },
        makeProfile({ fide_rating: { standard: 2000, rapid: 1600 } }),
        FIDE("classical"),
        NOW,
      );
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Age
  // -------------------------------------------------------------------------

  describe("age restriction", () => {
    it("returns null when player age is within min/max range", () => {
      const result = checkRestrictions(
        { min_age: 16, max_age: 20 },
        makeProfile({ date_of_birth: DOB_18 }),
        FIDE("rapid"),
        NOW,
      );
      expect(result).toBeNull();
    });

    it("returns 422 when date_of_birth is missing and age restriction is set", async () => {
      const result = checkRestrictions(
        { min_age: 18 },
        makeProfile({ date_of_birth: null }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when player is below min_age", async () => {
      const result = checkRestrictions(
        { min_age: 18 },
        makeProfile({ date_of_birth: DOB_17 }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      expect(json.error.message).toContain("18");
    });

    it("returns 422 when player exceeds max_age", async () => {
      const result = checkRestrictions(
        { max_age: 17 },
        makeProfile({ date_of_birth: DOB_18 }),
        FIDE("rapid"),
        NOW,
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      expect(json.error.message).toContain("17");
    });

    it("returns null when player is exactly at the age boundary", () => {
      expect(
        checkRestrictions(
          { min_age: 18 },
          makeProfile({ date_of_birth: DOB_18 }),
          FIDE("rapid"),
          NOW,
        ),
      ).toBeNull();

      expect(
        checkRestrictions(
          { max_age: 18 },
          makeProfile({ date_of_birth: DOB_18 }),
          FIDE("rapid"),
          NOW,
        ),
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// checkFeeTierEligibility
// ---------------------------------------------------------------------------

describe("checkFeeTierEligibility", () => {
  describe("no tier restrictions", () => {
    it("returns null for a standard tier with no restrictions", () => {
      const tier: FeeTier = {};
      expect(
        checkFeeTierEligibility(tier, makeProfile(), NOW, FIDE("classical")),
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Gender
  // -------------------------------------------------------------------------

  describe("gender restriction", () => {
    it("returns 400 when tier is female-only and player is male", async () => {
      const tier: FeeTier = { gender: "female" };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ gender: "male" }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
      expect(json.error.message).toContain("female");
    });

    it("returns null when tier is female-only and player is female", () => {
      const tier: FeeTier = { gender: "female" };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ gender: "female" }),
        NOW,
        FIDE("classical"),
      );
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // OKU
  // -------------------------------------------------------------------------

  describe("OKU restriction", () => {
    it("returns 400 when tier is OKU-only and player is not verified", async () => {
      const tier: FeeTier = { oku: true };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ oku_status: "none" }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
    });

    it("returns 400 when the player's OKU is only pending (not yet verified)", async () => {
      const tier: FeeTier = { oku: true };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ oku_status: "pending" }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
    });

    it("returns null when tier is OKU-only and player is verified OKU", () => {
      const tier: FeeTier = { oku: true };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ oku_status: "verified" }),
        NOW,
        FIDE("classical"),
      );
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Title
  // -------------------------------------------------------------------------

  describe("title restriction", () => {
    it("returns 400 when tier requires titles and player has no title", async () => {
      const tier: FeeTier = { titles: ["GM", "IM"] };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ title: null }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
    });

    it("returns 400 when tier requires titles and player has wrong title", async () => {
      const tier: FeeTier = { titles: ["GM", "IM"] };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ title: "FM" }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
    });

    it("returns null when player has a title matching the tier", () => {
      const tier: FeeTier = { titles: ["GM", "IM", "FM"] };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ title: "FM" }),
        NOW,
        FIDE("classical"),
      );
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Age
  // -------------------------------------------------------------------------

  describe("rating restriction", () => {
    it("returns null when the player's rating is inside the tier range", () => {
      const tier: FeeTier = { rating_min: 1500, rating_max: 1800 };
      expect(
        checkFeeTierEligibility(
          tier,
          makeProfile({ fide_rating: { standard: 1700 } }),
          NOW,
          FIDE("classical"),
        ),
      ).toBeNull();
    });

    it("returns 400 when the player's rating is below the tier's rating_min", async () => {
      const tier: FeeTier = { rating_min: 1800 };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ fide_rating: { standard: 1600 } }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
      expect(json.error.message).toContain("1800");
    });

    it("returns 400 when the player's rating exceeds the tier's rating_max", async () => {
      const tier: FeeTier = { rating_max: 1799 };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ fide_rating: { standard: 2000 } }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
      expect(json.error.message).toContain("1799");
    });

    it("treats the tier bounds as inclusive", () => {
      expect(
        checkFeeTierEligibility(
          { rating_min: 1500, rating_max: 1800 },
          makeProfile({ fide_rating: { standard: 1500 } }),
          NOW,
          FIDE("classical"),
        ),
      ).toBeNull();

      expect(
        checkFeeTierEligibility(
          { rating_min: 1500, rating_max: 1800 },
          makeProfile({ fide_rating: { standard: 1800 } }),
          NOW,
          FIDE("classical"),
        ),
      ).toBeNull();
    });

    it("blocks an unrated player from a tier with a floor", async () => {
      const result = checkFeeTierEligibility(
        { rating_min: 1500 },
        makeProfile({ fide_rating: null, national_rating: null }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
      expect(json.error.message).toMatch(/no FIDE standard rating/);
    });

    it("admits an unrated player to a tier that only caps the rating", () => {
      expect(
        checkFeeTierEligibility(
          { rating_max: 1500 },
          makeProfile({ fide_rating: null, national_rating: null }),
          NOW,
          FIDE("classical"),
        ),
      ).toBeNull();
    });

    it("ignores the national rating on a FIDE-rated tournament", async () => {
      // Nationally 1600, but no FIDE standard rating → unrated here, so the
      // cap admits them and the floor doesn't.
      const profile = makeProfile({
        fide_rating: null,
        national_rating: 1600,
      });

      expect(
        checkFeeTierEligibility(
          { rating_max: 1500 },
          profile,
          NOW,
          FIDE("classical"),
        ),
      ).toBeNull();

      const result = checkFeeTierEligibility(
        { rating_min: 1500 },
        profile,
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      expect((await result!.json()).error.message).toContain("FIDE standard");
    });

    it("judges an MCF-rated tournament on the national rating", async () => {
      const profile = makeProfile({
        fide_rating: { standard: 1400 },
        national_rating: 1600,
      });

      const result = checkFeeTierEligibility(
        { rating_max: 1500 },
        profile,
        NOW,
        MCF("classical"),
      );
      expect(result!.status).toBe(400);
    });

    it("takes whichever rating exists when neither federation rates the event", () => {
      expect(
        checkFeeTierEligibility(
          { rating_min: 1500 },
          makeProfile({ fide_rating: null, national_rating: 1600 }),
          NOW,
          UNRATED_EVENT("classical"),
        ),
      ).toBeNull();
    });

    it("judges a blitz tournament on the blitz rating, not the standard one", () => {
      const tier: FeeTier = { rating_max: 1500 };
      const profile = makeProfile({
        fide_rating: { standard: 2000, blitz: 1400 },
      });

      expect(
        checkFeeTierEligibility(tier, profile, NOW, FIDE("blitz")),
      ).toBeNull();
      expect(
        checkFeeTierEligibility(tier, profile, NOW, FIDE("classical"))!.status,
      ).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Age
  // -------------------------------------------------------------------------

  describe("age restriction", () => {
    it("returns 422 when date_of_birth is missing for age-restricted tier", async () => {
      const tier: FeeTier = { age_max: 18 };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ date_of_birth: null }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(422);
      const json = await result!.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when player is below the tier's min_age", async () => {
      const tier: FeeTier = { age_min: 18 };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ date_of_birth: DOB_17 }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
    });

    it("returns 400 when player exceeds the tier's max_age", async () => {
      const tier: FeeTier = { age_max: 17 };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ date_of_birth: DOB_18 }),
        NOW,
        FIDE("classical"),
      );
      expect(result!.status).toBe(400);
      const json = await result!.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
    });

    it("returns null when player is exactly at the tier age boundary", () => {
      expect(
        checkFeeTierEligibility(
          { age_min: 18 },
          makeProfile({ date_of_birth: DOB_18 }),
          NOW,
          FIDE("classical"),
        ),
      ).toBeNull();

      expect(
        checkFeeTierEligibility(
          { age_max: 18 },
          makeProfile({ date_of_birth: DOB_18 }),
          NOW,
          FIDE("classical"),
        ),
      ).toBeNull();
    });

    it("returns null for an under-19 tier when player is 18 (within range)", () => {
      const tier: FeeTier = { age_min: 0, age_max: 19 };
      const result = checkFeeTierEligibility(
        tier,
        makeProfile({ date_of_birth: DOB_18 }),
        NOW,
        FIDE("classical"),
      );
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// checkRatedRequirements
// ---------------------------------------------------------------------------

describe("checkRatedRequirements", () => {
  const UNRATED = { is_fide_rated: false, is_mcf_rated: false };

  it("returns null when the tournament is unrated", () => {
    expect(checkRatedRequirements(UNRATED, makeProfile())).toBeNull();
  });

  it("returns 422 when a FIDE-rated tournament player has no FIDE ID", async () => {
    const result = checkRatedRequirements(
      { is_fide_rated: true, is_mcf_rated: false },
      makeProfile({ fide_id: null }),
    );
    expect(result?.status).toBe(422);
    const json = await result!.json();
    expect(json.error.message).toMatch(/FIDE ID/);
  });

  it("returns null when a FIDE-rated tournament player has a FIDE ID", () => {
    expect(
      checkRatedRequirements(
        { is_fide_rated: true, is_mcf_rated: false },
        makeProfile({ fide_id: 5834567 }),
      ),
    ).toBeNull();
  });

  it("returns 422 when an MCF-rated tournament player has no MCF ID", async () => {
    const result = checkRatedRequirements(
      { is_fide_rated: false, is_mcf_rated: true },
      makeProfile({ mcf_id: null }),
    );
    expect(result?.status).toBe(422);
    const json = await result!.json();
    expect(json.error.message).toMatch(/MCF ID/);
  });

  it("returns null when an MCF-rated tournament player has an MCF ID", () => {
    expect(
      checkRatedRequirements(
        { is_fide_rated: false, is_mcf_rated: true },
        makeProfile({ mcf_id: 12345 }),
      ),
    ).toBeNull();
  });

  it("flags the missing FIDE ID first when both ratings are required", async () => {
    const result = checkRatedRequirements(
      { is_fide_rated: true, is_mcf_rated: true },
      makeProfile({ fide_id: null, mcf_id: null }),
    );
    const json = await result!.json();
    expect(json.error.message).toMatch(/FIDE ID/);
  });

  it("returns 422 for a missing profile on a rated tournament", () => {
    const result = checkRatedRequirements(
      { is_fide_rated: true, is_mcf_rated: false },
      null,
    );
    expect(result?.status).toBe(422);
  });
});
