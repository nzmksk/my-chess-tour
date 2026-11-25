// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/_actions/joinWaitlist", () => ({ joinWaitlist: vi.fn() }));

import WaitlistForm from "../WaitlistForm";

afterEach(cleanup);

describe("WaitlistForm", () => {
  it("starts on a required 'Your role' placeholder and lists every role", () => {
    render(<WaitlistForm />);
    const select = screen.getByLabelText("Your role") as HTMLSelectElement;
    expect(select.required).toBe(true);
    expect(select.value).toBe("");
    expect(select.options[0].disabled).toBe(true);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Your role",
      "Player",
      "Organizer / Chess club / Chess academy",
      "Parent",
      "Coach",
      "Arbiter",
      "Other",
    ]);
  });
});
