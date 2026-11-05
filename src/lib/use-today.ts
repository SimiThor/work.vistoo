"use client";

import { useSyncExternalStore } from "react";
import { todayIso } from "./dates";

/**
 * Today's calendar date in the *viewer's* time zone.
 * Returns null during SSR and hydration (the server cannot know the viewer's
 * time zone), then the real value — avoiding hydration mismatches. Updates
 * itself when the day changes while the app stays open.
 */
let current = typeof window === "undefined" ? "" : todayIso();

function subscribe(onChange: () => void) {
  const timer = setInterval(() => {
    const next = todayIso();
    if (next !== current) {
      current = next;
      onChange();
    }
  }, 60_000);
  return () => clearInterval(timer);
}

export function useToday(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current || (current = todayIso()),
    () => null,
  );
}
