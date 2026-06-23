import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetAll, mockSet, mockCreateServerClient } = vi.hoisted(() => ({
  mockGetAll: vi.fn().mockReturnValue([]),
  mockSet: vi.fn(),
  mockCreateServerClient: vi.fn(
    (_url: string, _key: string, options: unknown) => ({ _options: options }),
  ),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: mockGetAll,
    set: mockSet,
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mockCreateServerClient,
}));

import { createClient } from "../server";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll.mockReturnValue([]);
    mockSet.mockImplementation(() => {});
    mockCreateServerClient.mockImplementation(
      (_url: string, _key: string, options: unknown) => ({
        _options: options,
      }),
    );
  });

  it("calls createServerClient with Supabase URL and public key", async () => {
    await createClient();
    expect(mockCreateServerClient).toHaveBeenCalledWith(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY,
      expect.any(Object),
    );
  });

  it("getAll delegates to cookieStore.getAll", async () => {
    const cookies = [{ name: "sb-token", value: "abc", options: {} }];
    mockGetAll.mockReturnValue(cookies);

    await createClient();

    const { _options } = mockCreateServerClient.mock.results[0].value as {
      _options: { cookies: { getAll: () => unknown } };
    };
    expect(_options.cookies.getAll()).toEqual(cookies);
  });

  it("setAll calls cookieStore.set for each cookie", async () => {
    await createClient();

    const { _options } = mockCreateServerClient.mock.results[0].value as {
      _options: {
        cookies: {
          setAll: (
            c: Array<{ name: string; value: string; options: unknown }>,
          ) => void;
        };
      };
    };
    _options.cookies.setAll([
      { name: "a", value: "1", options: {} },
      { name: "b", value: "2", options: { httpOnly: true } },
    ]);

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledWith("a", "1", {});
    expect(mockSet).toHaveBeenCalledWith("b", "2", { httpOnly: true });
  });

  it("setAll strips maxAge/expires from sb- cookies when sessionOnly is true", async () => {
    await createClient({ sessionOnly: true });

    const { _options } = mockCreateServerClient.mock.results[0].value as {
      _options: {
        cookies: {
          setAll: (
            c: Array<{ name: string; value: string; options: unknown }>,
          ) => void;
        };
      };
    };
    _options.cookies.setAll([
      { name: "sb-token", value: "abc", options: { maxAge: 3600, path: "/" } },
    ]);

    expect(mockSet).toHaveBeenCalledWith(
      "sb-token",
      "abc",
      expect.not.objectContaining({ maxAge: 3600 }),
    );
  });

  it("setAll does not strip cookies when sessionOnly is false", async () => {
    await createClient({ sessionOnly: false });

    const { _options } = mockCreateServerClient.mock.results[0].value as {
      _options: {
        cookies: {
          setAll: (
            c: Array<{ name: string; value: string; options: unknown }>,
          ) => void;
        };
      };
    };
    _options.cookies.setAll([
      { name: "sb-token", value: "abc", options: { maxAge: 3600, path: "/" } },
    ]);

    expect(mockSet).toHaveBeenCalledWith("sb-token", "abc", {
      maxAge: 3600,
      path: "/",
    });
  });

  it("setAll silently catches errors thrown by cookieStore.set", async () => {
    mockSet.mockImplementation(() => {
      throw new Error("Cannot set cookies in Server Component");
    });

    await createClient();

    const { _options } = mockCreateServerClient.mock.results[0].value as {
      _options: {
        cookies: {
          setAll: (
            c: Array<{ name: string; value: string; options: unknown }>,
          ) => void;
        };
      };
    };

    expect(() =>
      _options.cookies.setAll([{ name: "a", value: "1", options: {} }]),
    ).not.toThrow();
  });
});
