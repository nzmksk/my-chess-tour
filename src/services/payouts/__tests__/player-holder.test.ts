import { describe, expect, it } from "vitest";
import { expectedPlayerHolderName } from "../player-holder";

const AZIZ = { first_name: "Aziz", last_name: "Adult" };

describe("expectedPlayerHolderName", () => {
  it("trusts the holder a player typed for their own account", () => {
    expect(
      expectedPlayerHolderName(
        { account_holder: "Aziz bin Adult", entered_by: null },
        AZIZ,
      ),
    ).toBe("Aziz bin Adult");
  });

  it("expects the player's name when someone else entered the account", () => {
    expect(
      expectedPlayerHolderName(
        { account_holder: "Hana Helper", entered_by: "helper-1" },
        AZIZ,
      ),
    ).toBe("Aziz Adult");
  });

  it("expects nothing to match when the player's name is unknown", () => {
    expect(
      expectedPlayerHolderName(
        { account_holder: "Hana Helper", entered_by: "helper-1" },
        null,
      ),
    ).toBeNull();
  });
});
