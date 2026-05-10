// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../ThemeProvider";

afterEach(cleanup);

function TestConsumer() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>Toggle</button>
    </div>
  );
}

function renderWithProvider(stored?: string) {
  if (stored !== undefined) localStorage.setItem("theme", stored);
  return render(
    <ThemeProvider>
      <TestConsumer />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark theme when localStorage is empty", () => {
    renderWithProvider();
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("reads 'light' theme from localStorage on mount", async () => {
    renderWithProvider("light");
    await act(async () => {});
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("reads 'dark' theme from localStorage on mount", async () => {
    renderWithProvider("dark");
    await act(async () => {});
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("ignores invalid localStorage values and stays dark", async () => {
    renderWithProvider("blue");
    await act(async () => {});
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("toggles dark → light on click", async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("toggles light → dark on click", async () => {
    renderWithProvider("light");
    await act(async () => {});
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("persists theme to localStorage on toggle", async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("sets data-theme attribute on documentElement when toggling", async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("useTheme outside ThemeProvider", () => {
  it("throws an error when used without a provider", () => {
    function Broken() {
      useTheme();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Broken />)).toThrow(
      "useTheme must be used within ThemeProvider",
    );
    spy.mockRestore();
  });
});
