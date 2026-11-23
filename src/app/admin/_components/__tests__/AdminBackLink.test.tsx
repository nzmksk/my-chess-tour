// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AdminBackLink from "../AdminBackLink";

afterEach(cleanup);

describe("AdminBackLink", () => {
  it("links back to the admin dashboard", () => {
    render(<AdminBackLink />);
    const link = screen.getByRole("link", {
      name: "← Back to Admin Dashboard",
    });
    expect(link.getAttribute("href")).toBe("/admin/dashboard");
  });
});
