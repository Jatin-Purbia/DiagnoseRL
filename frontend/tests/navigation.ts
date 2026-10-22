// A tiny stand-in for next/navigation that keeps the URL in a store, so components that put state
// in the query string (?session=, ?run=) behave like they do in the real router.
import { useSyncExternalStore } from "react";

type Listener = () => void;

class NavStore {
  search = "";
  path = "/";
  pushed: string[] = [];
  private listeners = new Set<Listener>();
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  snapshot = () => `${this.path}?${this.search}`;
  navigate(url: string) {
    const [p, q = ""] = url.split("?");
    this.path = p || this.path;
    this.search = q;
    this.pushed.push(url);
    this.listeners.forEach((l) => l());
  }
  reset(search = "", path = "/") {
    this.search = search;
    this.path = path;
    this.pushed = [];
    this.listeners.forEach((l) => l());
  }
}

export const navStore = new NavStore();

export function useSearchParams() {
  useSyncExternalStore(navStore.subscribe, navStore.snapshot, navStore.snapshot);
  return new URLSearchParams(navStore.search);
}

export function usePathname() {
  useSyncExternalStore(navStore.subscribe, navStore.snapshot, navStore.snapshot);
  return navStore.path;
}

export function useRouter() {
  return {
    replace: (u: string) => navStore.navigate(u),
    push: (u: string) => navStore.navigate(u),
    back: () => {},
    refresh: () => {},
    prefetch: () => {},
  };
}
