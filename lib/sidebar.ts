import { useSyncExternalStore } from "react";

// Desktop sidebar collapsed/open, remembered per browser. The server always renders it open.
const KEY = "sajada:sidebar";
const EVENT = "sajada-sidebar";
let current: boolean | null = null; // fallback when localStorage is unavailable

function read(): boolean {
  if (current !== null) return current;
  try {
    return localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const toggle = () => {
    current = !read();
    try {
      localStorage.setItem(KEY, current ? "collapsed" : "open");
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  };
  return [collapsed, toggle];
}
