// Visual verification: drives the real UI in a real browser (Edge) against a running backend and
// saves screenshots at desktop / tablet / mobile sizes, while recording console errors and
// horizontal overflow. Usage:  FRONTEND=http://localhost:3001 node scripts/screenshots.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const FRONTEND = process.env.FRONTEND ?? "http://localhost:3001";
const OUT = process.env.OUT ?? "../artifacts/screenshots";
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["overview", "/"],
  ["playground", "/playground"],
  ["investigations", "/investigations"],
  ["training", "/training"],
  ["comparison", "/comparison"],
  ["faults", "/faults"],
  ["experiments", "/experiments"],
  ["models", "/models"],
  ["settings", "/settings"],
];
const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }, false],
  ["tablet", { width: 1024, height: 768 }, false],
  ["mobile", { width: 390, height: 844 }, true],
];

const IGNORED = [/Download the React DevTools/, /\[Fast Refresh\]/, /favicon/i];
const report = { console: [], overflow: [], flows: [] };

const browser = await chromium.launch({ channel: "msedge", headless: true });

async function visit(page, name, vp, path, theme) {
  const errors = [];
  const onConsole = (m) => {
    if (m.type() === "error" && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text().slice(0, 300));
  };
  const onPageError = (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`);
  const onFailed = (r) => {
    // ERR_ABORTED is a request the app cancelled on purpose (React Query aborts stale queries on navigation).
    const reason = r.failure()?.errorText;
    if (!/favicon|_next\/static|hot-update/.test(r.url()) && reason !== "net::ERR_ABORTED") errors.push(`request failed: ${r.url()} ${reason}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onFailed);
  await page.goto(FRONTEND + path, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(900); // let chart animations settle
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  if (overflow.scrollWidth > overflow.innerWidth + 1) report.overflow.push({ name, vp, theme, ...overflow });
  await page.screenshot({ path: `${OUT}/${name}-${vp}-${theme}.png`, fullPage: true });
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("requestfailed", onFailed);
  if (errors.length) report.console.push({ name, vp, theme, errors });
}

for (const theme of ["dark", "light"]) {
  for (const [vp, size, mobile] of VIEWPORTS) {
    if (theme === "light" && vp !== "desktop") continue;
    const ctx = await browser.newContext({ viewport: size, isMobile: mobile, hasTouch: mobile, colorScheme: theme });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
    }, theme);
    const page = await ctx.newPage();
    for (const [name, path] of ROUTES) await visit(page, name, vp, path, theme);
    await ctx.close();
  }
}

// ---- the signature flow: agent-driven investigation, then replay (desktop)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await ctx.addInitScript(() => localStorage.setItem("theme", "dark"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && !IGNORED.some((r) => r.test(m.text())) && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));

  await page.goto(FRONTEND + "/playground", { waitUntil: "networkidle" });
  await page.getByLabel("Scenario").first().selectOption("standard");
  await page.getByLabel("Incident seed (optional)").fill("777");
  await page.getByRole("button", { name: /start investigation/i }).click();
  await page.getByRole("button", { name: /execute recommended test|declare as recommended/i }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/flow-1-started.png`, fullPage: true });

  // manual step with the recommendation
  await page.getByRole("button", { name: /execute recommended test/i }).click();
  await page.getByText(/Impact:/).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/flow-2-first-test.png`, fullPage: true });

  // switch to agent mode at 4x and let it finish
  await page.getByRole("radio", { name: /agent/i }).click();
  await page.getByLabel("Visualization speed").selectOption("4");
  await page.getByRole("button", { name: /run agent|resume/i }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/flow-3-agent-running.png`, fullPage: true });
  await page.getByText(/Correct diagnosis|Incorrect diagnosis|Step limit reached/).first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/flow-4-completed.png`, fullPage: true });
  report.flows.push({ completed: true, headline: await page.getByText(/Correct diagnosis|Incorrect diagnosis|Step limit reached/).first().innerText() });

  // replay
  await page.getByRole("button", { name: /replay investigation/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/flow-5-replay.png`, fullPage: true });

  // trace dialog is reachable from the completed investigation's URL
  report.flows.push({ url: page.url(), consoleErrors: errors });
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
