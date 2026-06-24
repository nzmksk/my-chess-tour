// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastAvatar, subscribeAvatar } from "../avatar-cache";

// vi.fn() used as a constructor requires 'function' or 'class' syntax, not arrow functions.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("broadcastAvatar", () => {
  it("returns without error when BroadcastChannel is unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(() =>
      broadcastAvatar("user-1", "https://example.com/avatar.png"),
    ).not.toThrow();
  });

  it("posts message via BroadcastChannel and closes channel", () => {
    const mockPostMessage = vi.fn();
    const mockClose = vi.fn();
    class MockChannel {
      postMessage = mockPostMessage;
      close = mockClose;
    }
    vi.stubGlobal("BroadcastChannel", MockChannel);

    broadcastAvatar("user-1", "https://example.com/avatar.png");

    expect(mockPostMessage).toHaveBeenCalledWith({
      userId: "user-1",
      url: "https://example.com/avatar.png",
    });
    expect(mockClose).toHaveBeenCalled();
  });

  it("posts message with null url", () => {
    const mockPostMessage = vi.fn();
    class MockChannel {
      postMessage = mockPostMessage;
      close = vi.fn();
    }
    vi.stubGlobal("BroadcastChannel", MockChannel);

    broadcastAvatar("user-1", null);

    expect(mockPostMessage).toHaveBeenCalledWith({
      userId: "user-1",
      url: null,
    });
  });
});

describe("subscribeAvatar", () => {
  it("returns a noop when BroadcastChannel is unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const unsubscribe = subscribeAvatar(vi.fn());
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("returns an unsubscribe function that closes the channel", () => {
    const mockClose = vi.fn();
    class MockChannel {
      onmessage: null = null;
      close = mockClose;
    }
    vi.stubGlobal("BroadcastChannel", MockChannel);

    const unsubscribe = subscribeAvatar(vi.fn());
    unsubscribe();

    expect(mockClose).toHaveBeenCalled();
  });

  it("calls onChange with the message when a valid event is received", () => {
    const mockClose = vi.fn();
    let capturedInstance: {
      onmessage: ((e: MessageEvent) => void) | null;
      close: typeof mockClose;
    };
    class MockChannel {
      onmessage: ((e: MessageEvent) => void) | null = null;
      close = mockClose;
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        capturedInstance = this;
      }
    }
    vi.stubGlobal("BroadcastChannel", MockChannel);

    const onChange = vi.fn();
    subscribeAvatar(onChange);

    capturedInstance!.onmessage!({
      data: { userId: "user-1", url: "https://example.com/avatar.png" },
    } as MessageEvent);

    expect(onChange).toHaveBeenCalledWith({
      userId: "user-1",
      url: "https://example.com/avatar.png",
    });
  });

  it("calls onChange with null url when url is missing from the message", () => {
    let capturedInstance: { onmessage: ((e: MessageEvent) => void) | null };
    class MockChannel {
      onmessage: ((e: MessageEvent) => void) | null = null;
      close = vi.fn();
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        capturedInstance = this;
      }
    }
    vi.stubGlobal("BroadcastChannel", MockChannel);

    const onChange = vi.fn();
    subscribeAvatar(onChange);

    capturedInstance!.onmessage!({
      data: { userId: "user-1", url: undefined },
    } as unknown as MessageEvent);

    expect(onChange).toHaveBeenCalledWith({ userId: "user-1", url: null });
  });

  it("ignores messages where userId is not a string", () => {
    let capturedInstance: { onmessage: ((e: MessageEvent) => void) | null };
    class MockChannel {
      onmessage: ((e: MessageEvent) => void) | null = null;
      close = vi.fn();
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        capturedInstance = this;
      }
    }
    vi.stubGlobal("BroadcastChannel", MockChannel);

    const onChange = vi.fn();
    subscribeAvatar(onChange);

    capturedInstance!.onmessage!({
      data: { userId: 123, url: "https://example.com/avatar.png" },
    } as unknown as MessageEvent);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores messages with null data", () => {
    let capturedInstance: { onmessage: ((e: MessageEvent) => void) | null };
    class MockChannel {
      onmessage: ((e: MessageEvent) => void) | null = null;
      close = vi.fn();
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        capturedInstance = this;
      }
    }
    vi.stubGlobal("BroadcastChannel", MockChannel);

    const onChange = vi.fn();
    subscribeAvatar(onChange);

    capturedInstance!.onmessage!({ data: null } as unknown as MessageEvent);

    expect(onChange).not.toHaveBeenCalled();
  });
});
