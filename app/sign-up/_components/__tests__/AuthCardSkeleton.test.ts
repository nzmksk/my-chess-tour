import { describe, expect, it } from "vitest";
import AuthCardSkeleton from "../AuthCardSkeleton";

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

describe("AuthCardSkeleton", () => {
  it("returns a non-null element", () => {
    const result = AuthCardSkeleton({});
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("renders with default props without throwing", () => {
    expect(() => AuthCardSkeleton({})).not.toThrow();
  });

  it("renders with custom row count without throwing", () => {
    expect(() => AuthCardSkeleton({ rows: 2 })).not.toThrow();
    expect(() => AuthCardSkeleton({ rows: 6 })).not.toThrow();
  });

  it("contains shimmer elements", () => {
    const result = AuthCardSkeleton({});
    const shimmer = findInTree(result, (el) => {
      const className = (el.props as Record<string, unknown> | undefined)?.className;
      return typeof className === "string" && className.includes("skeleton-shimmer");
    });
    expect(shimmer).not.toBeNull();
  });

  it("has the auth-page container class", () => {
    const result = AuthCardSkeleton({}) as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("auth-page");
  });

  it("has the auth-card class", () => {
    const result = AuthCardSkeleton({});
    const card = findInTree(result, (el) => {
      const className = (el.props as Record<string, unknown> | undefined)?.className;
      return typeof className === "string" && className.includes("auth-card");
    });
    expect(card).not.toBeNull();
  });
});
