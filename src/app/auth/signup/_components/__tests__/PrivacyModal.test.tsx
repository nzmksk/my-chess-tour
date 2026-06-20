// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import PrivacyModal from "../PrivacyModal";

afterEach(cleanup);

describe("PrivacyModal", () => {
  it("renders the modal with dialog role and aria-modal attribute", () => {
    render(<PrivacyModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("privacy-modal-title");
  });

  it("renders the Privacy Policy heading", () => {
    render(<PrivacyModal onClose={vi.fn()} />);
    expect(screen.getByText("Privacy Policy")).toBeDefined();
  });

  it("locks body scroll on mount and restores it on unmount", () => {
    document.body.style.overflow = "";
    const { unmount } = render(<PrivacyModal onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<PrivacyModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close privacy policy/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<PrivacyModal onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose for non-Escape key presses", () => {
    const onClose = vi.fn();
    render(<PrivacyModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when clicking directly on the overlay backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(<PrivacyModal onClose={onClose} />);
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when clicking inside the modal content area", () => {
    const onClose = vi.fn();
    const { container } = render(<PrivacyModal onClose={onClose} />);
    const modal = container.querySelector(".modal") as HTMLElement;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the keydown listener when unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(<PrivacyModal onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
