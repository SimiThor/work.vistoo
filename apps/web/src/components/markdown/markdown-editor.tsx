"use client";

import { Bold, Code, Heading, Italic, Link, List, ListChecks, ListOrdered } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { setChecklistItem } from "@vistoo/domain/markdown";
import { cn } from "@/lib/utils";
import { applyEdit, continueList, formatSelection, type Edit, type Format } from "./format";
import { loadMarkdownRenderer, MarkdownView } from "./markdown-view";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Strg+";

const TOOLS: { format: Format; label: string; icon: typeof Bold; keys?: string }[] = [
  { format: "heading", label: "Überschrift", icon: Heading },
  { format: "bold", label: "Fett", icon: Bold, keys: `${MOD}B` },
  { format: "italic", label: "Kursiv", icon: Italic, keys: `${MOD}I` },
  { format: "code", label: "Code", icon: Code, keys: `${MOD}E` },
  { format: "link", label: "Link", icon: Link, keys: `${MOD}K` },
  { format: "bullet", label: "Liste", icon: List, keys: `${MOD}⇧8` },
  { format: "number", label: "Nummerierte Liste", icon: ListOrdered, keys: `${MOD}⇧7` },
  { format: "task", label: "Checkliste", icon: ListChecks, keys: `${MOD}⇧L` },
];

function shortcut(e: KeyboardEvent): Format | "preview" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey) {
    return key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : key === "e" ? "code" : null;
  }
  // `code` is layout-independent (Shift+7 is "/" on German keyboards).
  if (e.code === "Digit7") return "number";
  if (e.code === "Digit8") return "bullet";
  if (e.code === "KeyL") return "task";
  if (e.code === "KeyP") return "preview";
  return null;
}

/**
 * Markdown editor in the style of GitHub: "Schreiben" (source, toolbar,
 * shortcuts, list continuation on Enter) and "Vorschau" (rendered exactly like
 * the read view). Switching never loses content: both show the same `value`.
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  autoFocus,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState(160);
  const pendingSelection = useRef<[number, number] | null>(null);
  const tabsId = useId();

  // Warm up the renderer chunk so Preview opens instantly.
  useEffect(() => void loadMarkdownRenderer(), []);

  useEffect(() => {
    if (autoFocus && ref.current) {
      const ta = ref.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [autoFocus]);

  // Selection after a fallback (non-undoable) edit, once React rendered the new value.
  useEffect(() => {
    const sel = pendingSelection.current;
    if (sel && ref.current) {
      ref.current.setSelectionRange(sel[0], sel[1]);
      pendingSelection.current = null;
    }
  });

  const apply = (edit: Edit) => {
    const ta = ref.current;
    if (!ta) return;
    const expected = applyEdit(ta.value, edit);
    ta.focus();
    ta.setSelectionRange(edit.from, edit.to);
    // insertText keeps the browser's undo stack (⌘Z) intact.
    let ok = false;
    try {
      ok =
        edit.insert !== ""
          ? document.execCommand("insertText", false, edit.insert)
          : edit.from === edit.to || document.execCommand("delete", false);
    } catch {
      ok = false;
    }
    if (ok && ta.value === expected) {
      ta.setSelectionRange(edit.selStart, edit.selEnd);
    } else {
      pendingSelection.current = [edit.selStart, edit.selEnd];
      onChange(expected);
    }
  };

  const format = (f: Format) => {
    const ta = ref.current;
    if (!ta || disabled) return;
    apply(formatSelection(ta.value, ta.selectionStart, ta.selectionEnd, f));
  };

  const switchTab = (next: "write" | "preview") => {
    if (next === tab) return;
    if (next === "preview" && ref.current) setHeight(ref.current.offsetHeight);
    setTab(next);
    if (next === "write") requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = shortcut(e);
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      if (action === "preview") switchTab("preview");
      else format(action);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing) {
      const ta = e.currentTarget;
      const edit = continueList(ta.value, ta.selectionStart, ta.selectionEnd);
      if (edit) {
        e.preventDefault();
        apply(edit);
      }
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/35",
        disabled && "opacity-70",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b bg-surface-subtle/60 px-1.5 py-1">
        <div role="tablist" aria-label="Schreiben oder Vorschau" className="flex rounded-md bg-surface-sunken/70 p-0.5">
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${tabsId}-${t}`}
              aria-selected={tab === t}
              aria-controls={`${tabsId}-${t}-panel`}
              onClick={() => switchTab(t)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const other = t === "write" ? "preview" : "write";
                  switchTab(other);
                  document.getElementById(`${tabsId}-${other}`)?.focus();
                }
              }}
              tabIndex={tab === t ? 0 : -1}
              className={cn(
                "h-6 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                tab === t ? "bg-background text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "write" ? "Schreiben" : "Vorschau"}
            </button>
          ))}
        </div>
        {tab === "write" && !disabled && (
          <div role="toolbar" aria-label="Formatierung" aria-controls={id} className="flex flex-wrap items-center">
            {TOOLS.map(({ format: f, label, icon: Icon, keys }, i) => (
              <span key={f} className="contents">
                {(i === 1 || i === 5) && <span aria-hidden className="mx-1 h-4 w-px bg-border" />}
                <button
                  type="button"
                  // Keep the textarea selection when clicking a tool.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => format(f)}
                  aria-label={keys ? `${label} (${keys})` : label}
                  title={keys ? `${label} (${keys})` : label}
                  className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-surface-sunken hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Icon className="size-[15px]" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div role="tabpanel" id={`${tabsId}-write-panel`} aria-labelledby={`${tabsId}-write`} hidden={tab !== "write"}>
        <textarea
          ref={ref}
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck
          className="field-sizing-content block min-h-40 w-full resize-y bg-transparent px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap outline-none placeholder:text-muted-foreground"
        />
      </div>
      {tab === "preview" && (
        <div
          role="tabpanel"
          id={`${tabsId}-preview-panel`}
          aria-labelledby={`${tabsId}-preview`}
          tabIndex={0}
          className="px-3 py-2 outline-none"
          style={{ minHeight: height }}
        >
          {value.trim() ? (
            <MarkdownView
              source={value}
              disabled={disabled}
              // Ticking in the preview changes the draft; it is saved with the form.
              onToggle={(item, checked) => onChange(setChecklistItem(value, item.index, checked, item.text) ?? value)}
            />
          ) : (
            <p className="py-1 text-sm text-muted-foreground">Nichts für die Vorschau.</p>
          )}
        </div>
      )}
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        Markdown wird unterstützt · <code className="font-mono">- [ ]</code> für Checklisten
      </p>
    </div>
  );
}
