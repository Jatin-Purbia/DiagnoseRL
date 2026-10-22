import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Recharts measures its container; jsdom has no layout engine, so give elements a size.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

const WIDTH = 600;
const HEIGHT = 320;
for (const [prop, value] of [
  ["offsetWidth", WIDTH],
  ["clientWidth", WIDTH],
  ["offsetHeight", HEIGHT],
  ["clientHeight", HEIGHT],
] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
}
HTMLElement.prototype.getBoundingClientRect = () =>
  ({
    width: WIDTH,
    height: HEIGHT,
    top: 0,
    left: 0,
    right: WIDTH,
    bottom: HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

afterEach(() => cleanup());

// Router and theme provider stand-ins (see tests/navigation.ts).
vi.mock("next/navigation", async () => await import("./navigation"));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => {
    return <a href={href} {...rest}>{children}</a>;
  },
}));
vi.mock("next-themes", async () => {
  const React = await import("react");
  let theme = "dark";
  const listeners = new Set<() => void>();
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => {
      const t = React.useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => theme,
        () => theme,
      );
      return {
        theme: t,
        resolvedTheme: t,
        setTheme: (n: string) => {
          theme = n;
          listeners.forEach((l) => l());
        },
      };
    },
  };
});
