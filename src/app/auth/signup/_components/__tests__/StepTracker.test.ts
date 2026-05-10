import { describe, expect, it } from "vitest";
import StepTracker from "../StepTracker";
import type { Step } from "../StepTracker";

function findInTree(node: unknown, predicate: (el: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const el = node as Record<string, unknown>;
  if (predicate(el)) return el;
  const children = (el.props as Record<string, unknown> | undefined)?.children;
  if (!children) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findInTree(child, predicate);
    if (found) return found;
  }
  return null;
}

function collectText(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  const el = node as Record<string, unknown>;
  const children = (el.props as Record<string, unknown> | undefined)?.children;
  if (!children) return "";
  const arr = Array.isArray(children) ? children : [children];
  return arr.map(collectText).join("");
}

describe("StepTracker", () => {
  const threeSteps: Step[] = [
    { label: "Account", state: "current" },
    { label: "Profile", state: "pending" },
    { label: "Verify", state: "pending" },
  ];

  it("returns a non-null element", () => {
    const result = StepTracker({ steps: threeSteps });
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("renders all step labels", () => {
    const result = StepTracker({ steps: threeSteps });
    const text = collectText(result);
    expect(text).toContain("Account");
    expect(text).toContain("Profile");
    expect(text).toContain("Verify");
  });

  it("shows step numbers for pending and current steps", () => {
    const result = StepTracker({ steps: threeSteps });
    const text = collectText(result);
    expect(text).toContain("1");
    expect(text).toContain("2");
    expect(text).toContain("3");
  });

  it("shows checkmark for done steps", () => {
    const steps: Step[] = [
      { label: "Account", state: "done" },
      { label: "Profile", state: "current" },
      { label: "Verify", state: "pending" },
    ];
    const result = StepTracker({ steps });
    const text = collectText(result);
    expect(text).toContain("✓");
  });

  it("applies current class to the current step circle", () => {
    const result = StepTracker({ steps: threeSteps });
    const currentCircle = findInTree(result, (el) => {
      const className = (el.props as Record<string, unknown> | undefined)?.className;
      return typeof className === "string" && className.includes("step-circle--current");
    });
    expect(currentCircle).not.toBeNull();
  });

  it("applies done class to done step circles", () => {
    const steps: Step[] = [
      { label: "Account", state: "done" },
      { label: "Profile", state: "done" },
      { label: "Verify", state: "current" },
    ];
    const result = StepTracker({ steps });
    const doneCircle = findInTree(result, (el) => {
      const className = (el.props as Record<string, unknown> | undefined)?.className;
      return typeof className === "string" && className.includes("step-circle--done");
    });
    expect(doneCircle).not.toBeNull();
  });

  it("renders connectors between steps", () => {
    const result = StepTracker({ steps: threeSteps });
    const connector = findInTree(result, (el) => {
      const className = (el.props as Record<string, unknown> | undefined)?.className;
      return typeof className === "string" && className.includes("step-connector");
    });
    expect(connector).not.toBeNull();
  });

  it("applies done class to connectors after done steps", () => {
    const steps: Step[] = [
      { label: "Account", state: "done" },
      { label: "Profile", state: "current" },
      { label: "Verify", state: "pending" },
    ];
    const result = StepTracker({ steps });
    const doneConnector = findInTree(result, (el) => {
      const className = (el.props as Record<string, unknown> | undefined)?.className;
      return typeof className === "string" && className.includes("step-connector--done");
    });
    expect(doneConnector).not.toBeNull();
  });
});
