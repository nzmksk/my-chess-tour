import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/LoginForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import LoginPage from "../page";

const defaultProps = {
  searchParams: Promise.resolve({}),
};

describe("LoginPage", () => {
  it("returns a non-null React element", async () => {
    const result = await LoginPage(defaultProps);
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", async () => {
    const result = (await LoginPage(defaultProps)) as unknown as Record<
      string,
      unknown
    >;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with title 'Sign In'", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toBe("Sign In");
  });

  it("passes successMessage when message is 'password-updated'", async () => {
    const result = (await LoginPage({
      searchParams: Promise.resolve({ message: "password-updated" }),
    })) as unknown as {
      props: { children: { props: Record<string, unknown> }[] };
    };
    const loginFormProps = result.props.children[1].props;
    expect(loginFormProps.successMessage).toContain("Password updated");
    expect(loginFormProps.infoMessage).toBeUndefined();
  });

  it("passes infoMessage when message is 'login-required'", async () => {
    const result = (await LoginPage({
      searchParams: Promise.resolve({ message: "login-required" }),
    })) as unknown as {
      props: { children: { props: Record<string, unknown> }[] };
    };
    const loginFormProps = result.props.children[1].props;
    expect(loginFormProps.infoMessage).toContain("log in");
    expect(loginFormProps.successMessage).toBeUndefined();
  });

  it("passes undefined for both messages when message is unrecognised", async () => {
    const result = (await LoginPage({
      searchParams: Promise.resolve({ message: "other-value" }),
    })) as unknown as {
      props: { children: { props: Record<string, unknown> }[] };
    };
    const loginFormProps = result.props.children[1].props;
    expect(loginFormProps.successMessage).toBeUndefined();
    expect(loginFormProps.infoMessage).toBeUndefined();
  });

  it("passes redirectTo prop to LoginForm", async () => {
    const result = (await LoginPage({
      searchParams: Promise.resolve({ redirectTo: "/dashboard" }),
    })) as unknown as {
      props: { children: { props: Record<string, unknown> }[] };
    };
    const loginFormProps = result.props.children[1].props;
    expect(loginFormProps.redirectTo).toBe("/dashboard");
  });
});
