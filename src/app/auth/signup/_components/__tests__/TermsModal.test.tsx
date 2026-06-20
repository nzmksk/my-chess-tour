// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import TermsModal from "../TermsModal";

afterEach(cleanup);

describe("TermsModal", () => {
  it("renders the modal with dialog role and aria-modal attribute", () => {
    render(<TermsModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("terms-modal-title");
  });

  it("renders the Terms of Service heading", () => {
    render(<TermsModal onClose={vi.fn()} />);
    expect(screen.getByText("Terms of Service")).toBeDefined();
  });

  it("locks body scroll on mount and restores it on unmount", () => {
    document.body.style.overflow = "";
    const { unmount } = render(<TermsModal onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<TermsModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close terms of service/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<TermsModal onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose for non-Escape key presses", () => {
    const onClose = vi.fn();
    render(<TermsModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when clicking directly on the overlay backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(<TermsModal onClose={onClose} />);
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when clicking inside the modal content area", () => {
    const onClose = vi.fn();
    const { container } = render(<TermsModal onClose={onClose} />);
    const modal = container.querySelector(".modal") as HTMLElement;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the keydown listener when unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(<TermsModal onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
