"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Rounded search input on the left of every list toolbar (see ListToolbar).
 * `debounceMs` delays `onChange` while typing (e.g. when it updates the URL).
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = "Suchen …",
  debounceMs = 0,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  debounceMs?: number;
}) {
  const id = useId();
  const [local, setLocal] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // External change (reset, back/forward)
    setLastValue(value);
    setLocal(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (v: string, immediate = false) => {
    setLocal(v);
    clearTimeout(timer.current);
    if (immediate || debounceMs <= 0) onChange(v);
    else timer.current = setTimeout(() => onChange(v), debounceMs);
  };

  return (
    <div className="relative w-full shrink-0 sm:w-64">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        type="search"
        value={local}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        className="h-9 w-full rounded-full border border-input bg-background pr-9 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button
          type="button"
          onClick={() => change("", true)}
          aria-label="Suche leeren"
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
