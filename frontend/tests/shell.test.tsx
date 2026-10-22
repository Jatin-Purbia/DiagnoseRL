import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/shell/AppShell";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { NAV_ITEMS, isActive, titleFor } from "@/components/shell/nav";
import { TopNavbar } from "@/components/shell/TopNavbar";
import { setAdminKey } from "@/lib/api";
import { err, mockApi, ok, renderWithProviders } from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.style.removeProperty("--sidebar-w");
});

const overview = (models: { id: string; name: string; scenario: string }[] = []) =>
  ok({ active_models: models, strategy_comparison: [], latest_evaluation_id: null });
const ready = ok({ status: "ready", checks: { database: "ok", artifacts: "ok" } });

describe("navigation model", () => {
  it("has the nine required sections in order", () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      "Overview",
      "Diagnostic Playground",
      "Live Investigations",
      "RL Training",
      "Algorithm Comparison",
      "Fault Explorer",
      "Experiment History",
      "Model Registry",
      "Settings",
    ]);
  });
  it("matches routes exactly for the root and by prefix elsewhere", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/playground", "/")).toBe(false);
    expect(isActive("/training/anything", "/training")).toBe(true);
    expect(isActive("/trainingx", "/training")).toBe(false);
    expect(titleFor("/models")).toBe("Model Registry");
    expect(titleFor("/nowhere")).toBe("DiagnoseRL");
  });
});

describe("AppSidebar", () => {
  it("links every section and marks the current page", () => {
    renderWithProviders(<AppSidebar />, { path: "/comparison" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link")).toHaveLength(9);
    expect(within(nav).getByRole("link", { name: "Algorithm Comparison" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("collapses to icons, keeps links accessible, remembers the choice, and resizes the page", async () => {
    const { unmount } = renderWithProviders(<AppSidebar />);
    const sidebar = document.querySelector("aside")!;
    expect(sidebar.dataset.collapsed).toBe("false");
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe("16rem");

    await userEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(sidebar.dataset.collapsed).toBe("true");
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument(); // still reachable by name
    expect(screen.queryByText("Overview", { selector: "span" })).not.toBeInTheDocument(); // label hidden
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe("72px");
    expect(localStorage.getItem("diagnoserl.sidebarCollapsed")).toBe("1");
    unmount();

    renderWithProviders(<AppSidebar />);
    await waitFor(() => expect(document.querySelector("aside")!.dataset.collapsed).toBe("true")); // restored
    await userEvent.click(screen.getByRole("button", { name: /expand sidebar/i }));
    expect(localStorage.getItem("diagnoserl.sidebarCollapsed")).toBe("0");
  });
});

describe("TopNavbar", () => {
  const routes = (extra = {}) => ({ "GET /health/ready": ready, "GET /api/v1/overview": overview(), ...extra });

  it("shows the page title as a breadcrumb and that the environment is a simulation", async () => {
    mockApi(routes());
    renderWithProviders(<TopNavbar />, { path: "/training" });
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("RL Training");
    expect(screen.getByText("Simulation")).toBeInTheDocument();
  });

  it("shows the investigation id for a playground session", async () => {
    mockApi(routes());
    renderWithProviders(<TopNavbar />, { path: "/playground", search: "session=3f9a2c10-0000-0000-0000-000000000000" });
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Investigations");
    expect(crumbs).toHaveTextContent("3f9a2c10");
  });

  it("reflects the real backend connection state", async () => {
    mockApi(routes());
    const { unmount } = renderWithProviders(<TopNavbar />);
    expect(await screen.findByRole("status", { name: "Backend Connected" })).toBeInTheDocument();
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const second = renderWithProviders(<TopNavbar />);
    expect(await screen.findByRole("status", { name: "Backend Offline" })).toBeInTheDocument();
    second.unmount();

    mockApi({ ...routes(), "GET /health/ready": () => ({ json: { status: "not_ready", checks: { database: "unavailable", artifacts: "ok" } } }) });
    renderWithProviders(<TopNavbar />);
    expect(await screen.findByRole("status", { name: "Backend Degraded" })).toBeInTheDocument();
  });

  it("does not claim a connection while it is still checking", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderWithProviders(<TopNavbar />);
    expect(await screen.findByRole("status", { name: "Backend Checking…" })).toBeInTheDocument();
  });

  it("shows the active model or says there is none", async () => {
    mockApi(routes({ "GET /api/v1/overview": overview([{ id: "m", name: "full_seed0:best", scenario: "standard" }]) }));
    const { unmount } = renderWithProviders(<TopNavbar />);
    expect(await screen.findByRole("link", { name: /full_seed0:best/ })).toHaveAttribute("href", "/models");
    unmount();
    mockApi(routes());
    renderWithProviders(<TopNavbar />);
    expect(await screen.findByRole("link", { name: /no active model/i })).toBeInTheDocument();
  });

  it("toggles between dark and light themes", async () => {
    mockApi(routes());
    renderWithProviders(<TopNavbar />);
    await userEvent.click(await screen.findByRole("button", { name: /switch to light theme/i }));
    const back = await screen.findByRole("button", { name: /switch to dark theme/i });
    await userEvent.click(back);
    expect(await screen.findByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();
  });

  it("describes access honestly instead of inventing a user", async () => {
    mockApi(routes());
    setAdminKey("k");
    renderWithProviders(<TopNavbar />);
    await userEvent.click(await screen.findByRole("button", { name: "Access menu" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText(/no user accounts/i)).toBeInTheDocument();
    expect(within(menu).getByText("set for this tab")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /settings/i })).toBeInTheDocument();
  });

  it("opens the navigation drawer on small screens", async () => {
    mockApi(routes());
    renderWithProviders(<TopNavbar />);
    await userEvent.click(await screen.findByRole("button", { name: /open navigation/i }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getAllByRole("link").length).toBeGreaterThanOrEqual(9);
  });
});

describe("AppShell", () => {
  it("renders the page inside the shell with a skip link and a main landmark", async () => {
    mockApi({ "GET /health/ready": ready, "GET /api/v1/overview": overview() });
    renderWithProviders(
      <AppShell>
        <h1>Page body</h1>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "Page body" }));
  });

  it("keeps working when the backend is unreachable (the shell itself never needs it)", async () => {
    mockApi({ "GET /health/ready": err(500, "internal_error", "x"), "GET /api/v1/overview": err(500, "internal_error", "x") });
    renderWithProviders(<AppShell><p>content</p></AppShell>);
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: /Backend Offline/ })).toBeInTheDocument();
  });
});
