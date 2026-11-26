// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/tournaments/kl-open/register",
}));

import ParticipantPicker from "../ParticipantPicker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PARTICIPANTS = [
  { id: "u1", label: "Myself", isSelf: true, disabled: false },
  { id: "dep-1", label: "Aina Rahman", isSelf: false, disabled: false },
];

describe("ParticipantPicker", () => {
  it("lists yourself and each dependent, with the current player selected", () => {
    render(
      <ParticipantPicker participants={PARTICIPANTS} selectedId="dep-1" />,
    );
    const select = screen.getByLabelText(
      "Who is playing?",
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Myself",
      "Aina Rahman",
    ]);
    expect(select.value).toBe("dep-1");
  });

  it("switches to a dependent through the participant query", () => {
    render(<ParticipantPicker participants={PARTICIPANTS} selectedId="u1" />);
    fireEvent.change(screen.getByLabelText("Who is playing?"), {
      target: { value: "dep-1" },
    });
    expect(mockPush).toHaveBeenCalledWith(
      "/tournaments/kl-open/register?participant=dep-1",
    );
  });

  it("switches back to yourself with the plain URL", () => {
    render(
      <ParticipantPicker participants={PARTICIPANTS} selectedId="dep-1" />,
    );
    fireEvent.change(screen.getByLabelText("Who is playing?"), {
      target: { value: "u1" },
    });
    expect(mockPush).toHaveBeenCalledWith("/tournaments/kl-open/register");
  });

  it("lists a player who can no longer be registered as a disabled option", () => {
    render(
      <ParticipantPicker
        participants={[
          ...PARTICIPANTS,
          {
            id: "dep-2",
            label: "Jane Doe (turned 18, registers themselves)",
            isSelf: false,
            disabled: true,
          },
        ]}
        selectedId="u1"
      />,
    );
    const select = screen.getByLabelText(
      "Who is playing?",
    ) as HTMLSelectElement;
    const option = Array.from(select.options).find((o) => o.value === "dep-2");
    expect(option?.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "dep-2" } });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
