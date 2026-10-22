// Finds what makes a page wider than the viewport. Lists the elements whose right edge passes it,
// including positioned and shadow-DOM elements, and flags those that are NOT inside a horizontally
// scrollable container (those are the real causes).
// Usage:  MSYS_NO_PATHCONV=1 node scripts/overflow-probe.mjs /models 1024 768
import { chromium } from "playwright-core";

const [, , path = "/", width = "1024", height = "768"] = process.argv;
const base = process.env.FRONTEND ?? "http://localhost:3001";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
await page.goto(base + path, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(800);
const result = await page.evaluate(() => {
  const vw = window.innerWidth;
  const rows = [];
  const insideScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > vw + 1) {
        const cs = getComputedStyle(el);
        rows.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 80),
          position: cs.position,
          right: Math.round(b.right),
          width: Math.round(b.width),
          inScroller: insideScroller(el),
        });
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  rows.sort((a, b) => b.right - a.right);
  return { scrollWidth: document.documentElement.scrollWidth, viewport: vw, causes: rows.filter((r) => !r.inScroller).slice(0, 8), clipped: rows.filter((r) => r.inScroller).length };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
