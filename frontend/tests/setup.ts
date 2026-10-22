import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
