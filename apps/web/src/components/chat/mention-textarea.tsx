"use client";

import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusIcon } from "@/components/status-icon";
import { displayName, type IssueRefDTO, type TaskStatus } from "@vistoo/domain";
import { formatIssueNumber, rankIssues } from "@vistoo/domain/issue-refs";
import {
  applyEditorChange,
  matchesMentionQuery,
  MENTION_ALL_LABEL,
  type EditorMention,
} from "@vistoo/domain/mentions";
import { searchIssuesAction } from "@/app/actions/issue-refs";
import { cn } from "@/lib/utils";
import { issueRefNumber, primeIssueRefs, requestIssueRefs, useIssueRefsVersion } from "./issue-refs";

export type MentionPerson = { userId: string; fullName: string | null; email: string };
export type MentionValue = { text: string; mentions: EditorMention[] };

const MAX_SUGGESTIONS = 8;
const MAX_QUERY = 40;
const MAX_ISSUE_QUERY = 60;
const ISSUE_SEARCH_DELAY = 120; // ms
const LIST_WIDTH = 288; // 18rem
const ISSUE_LIST_WIDTH = 352; // 22rem: titles need more room
const GUTTER = 8;

type Trigger = "@" | "#";
type Query = { start: number; query: string; trigger: Trigger };
type Suggestion = { kind: "person"; person: MentionPerson } | { kind: "issue"; issue: IssueRefDTO } | { kind: "all" };

/** `@all` is offered for an empty query and while the query is a prefix of "all"/"alle". */
const matchesAll = (query: string) => {
  const q = query.trim().toLowerCase();
  return "all".startsWith(q) || "alle".startsWith(q);
};

/** The `@query` (people) or `#query` (tasks) the caret is in, or null. */
function activeQuery(value: MentionValue, caret: number): Query | null {
  const before = value.text.slice(0, caret);
  const at = Math.max(before.lastIndexOf("@"), before.lastIndexOf("#"));
  if (at < 0) return null;
  const trigger = before[at] as Trigger;
  // Only at a word start: not in e-mail addresses, "C#", URLs with anchors etc.
  if (at > 0 && !/[\s([{"'„“«]/u.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  const maxLen = trigger === "#" ? MAX_ISSUE_QUERY : MAX_QUERY;
  const maxSpaces = trigger === "#" ? 4 : 2;
  if (query.length > maxLen || /\n/.test(query) || /\s{2}/.test(query) || /^\s/.test(query)) return null;
  if ((query.match(/\s/g) ?? []).length > maxSpaces) return null;
  if (value.mentions.some((m) => at >= m.start && at < m.end)) return null; // inside an existing mention/reference
  return { start: at, query, trigger };
}

/**
 * Issue ranges whose label is outdated (e.g. a restored draft rendered before
 * the number was known) get their current `#24` label. Null if nothing changed.
 */
function relabelIssues(value: MentionValue, numberOf: (id: string) => number | null): MentionValue | null {
  let text = "";
  let last = 0;
  let changed = false;
  const mentions: EditorMention[] = [];
  for (const m of [...value.mentions].sort((a, b) => a.start - b.start)) {
    const n = m.taskId !== undefined ? numberOf(m.taskId) : null;
    const old = value.text.slice(m.start, m.end);
    const label = n ? formatIssueNumber(n) : old;
    if (label !== old) changed = true;
    text += value.text.slice(last, m.start);
    mentions.push({ ...m, start: text.length, end: text.length + label.length });
    text += label;
    last = m.end;
  }
  text += value.text.slice(last);
  return changed ? { text, mentions } : null;
}

export type MentionTextareaHandle = {
  focus: () => void;
  /** Places the caret (e.g. at the end after loading a draft). */
  setCaret: (pos: number) => void;
};

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "defaultValue"> & {
  value: MentionValue;
  onValueChange: (value: MentionValue) => void;
  /** People who may be mentioned here (already filtered by the caller). */
  candidates: readonly MentionPerson[];
  wrapperClassName?: string;
};

/**
 * Plain textarea with @mentions and #issue references. Typing `@` opens a
 * list of people (live filtered by first and last name), `#` a list of tasks
 * (searched on the server by number and title, only tasks the user can see).
 * Both share one list: arrows/Enter/Tab/Escape, click outside and the mouse
 * work. Inserted mentions and references are atomic: changing any character
 * of one removes it as a whole. They are highlighted by a backdrop that mirrors
 * the text exactly, so the textarea keeps native editing, IME and mobile
 * behaviour.
 */
export const MentionTextarea = forwardRef<MentionTextareaHandle, Props>(function MentionTextarea(
  { value, onValueChange, candidates, className, wrapperClassName, onKeyDown, onBlur, onScroll, ...rest },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaretState] = useState<number | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; placement: "above" | "below" } | null>(null);
  const listId = useId();

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setCaret: (p: number) => {
      const el = taRef.current;
      if (el) el.setSelectionRange(p, p);
    },
  }));

  const query = caret === null ? null : activeQuery(value, caret);
  const open = query !== null && query.start !== dismissedAt;
  const trigger = query?.trigger ?? "@";
  const issueQuery = open && query?.trigger === "#" ? query.query : null;

  // `#`: server search (debounced). Until fresh results arrive, the previous
  // ones are re-ranked locally so the list does not flicker while typing.
  const [issueHits, setIssueHits] = useState<{ q: string; items: IssueRefDTO[] }>({ q: "", items: [] });
  useEffect(() => {
    if (issueQuery === null) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void searchIssuesAction({ q: issueQuery }).then((res) => {
        if (cancelled || !res.ok) return;
        primeIssueRefs(res.data);
        setIssueHits({ q: issueQuery, items: res.data });
      });
    }, ISSUE_SEARCH_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [issueQuery]);

  const suggestions = useMemo((): Suggestion[] => {
    if (!open || !query) return [];
    if (query.trigger === "#") {
      const items = issueHits.q === query.query ? issueHits.items : rankIssues(issueHits.items, query.query, MAX_SUGGESTIONS);
      return items.map((issue) => ({ kind: "issue", issue }));
    }
    const offerAll = candidates.length > 0 && matchesAll(query.query);
    const people = candidates
      .filter((p) => matchesMentionQuery(p, query.query))
      .slice(0, offerAll ? MAX_SUGGESTIONS - 1 : MAX_SUGGESTIONS)
      .map((person): Suggestion => ({ kind: "person", person }));
    if (!offerAll) return people;
    // While nothing is typed, people come first so "@" + Enter never pings everyone by accident.
    return query.query.trim() ? [{ kind: "all" }, ...people] : [...people, { kind: "all" }];
  }, [open, query, candidates, issueHits]);
  const showList = open && suggestions.length > 0;
  const listWidth = trigger === "#" ? ISSUE_LIST_WIDTH : LIST_WIDTH;

  // Labels of references whose number was unknown when the text was loaded.
  const refsVersion = useIssueRefsVersion();
  useEffect(() => {
    const unknown = value.mentions.flatMap((m) => (m.taskId !== undefined && issueRefNumber(m.taskId) === null ? [m.taskId] : []));
    if (unknown.length) requestIssueRefs(unknown);
    const next = relabelIssues(value, issueRefNumber);
    if (next) onValueChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsVersion, value]);
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));

  // Restore the caret after a programmatic change (selection, atomic delete).
  useLayoutEffect(() => {
    const el = taRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    if (backdropRef.current && el) backdropRef.current.scrollTop = el.scrollTop;
  }, [value]);

  // Position the list at the `@` (fixed, so scroll containers cannot clip it).
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return setPos(null);
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(listWidth, vw - 2 * GUTTER);
    const left = Math.max(GUTTER, Math.min(r.left - 8, vw - width - GUTTER));
    const estimatedHeight = Math.min(suggestions.length, MAX_SUGGESTIONS) * 40 + 12;
    const placement = r.top - estimatedHeight - GUTTER > 0 ? "above" : "below";
    setPos({ left, top: placement === "above" ? r.top - 6 : r.bottom + 6, placement });
  }, [suggestions.length, listWidth]);

  useLayoutEffect(() => {
    if (!showList) return;
    place();
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    window.visualViewport?.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      window.visualViewport?.removeEventListener("resize", onMove);
    };
  }, [showList, place, value.text]);

  // Click/tap outside closes the list (the textarea keeps its text).
  useEffect(() => {
    if (!showList) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (taRef.current?.contains(t) || document.getElementById(listId)?.contains(t)) return;
      setDismissedAt(query?.start ?? null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showList, listId, query?.start]);

  const syncCaret = () => {
    const el = taRef.current;
    if (el) setCaretState(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };

  const choose = (s: Suggestion) => {
    if (!query || caret === null) return;
    if (s.kind === "issue") primeIssueRefs([s.issue]);
    const label =
      s.kind === "issue" ? formatIssueNumber(s.issue.number) : s.kind === "all" ? MENTION_ALL_LABEL : `@${displayName(s.person)}`;
    const range: EditorMention =
      s.kind === "issue"
        ? { start: query.start, end: query.start + label.length, taskId: s.issue.id }
        : s.kind === "all"
          ? { start: query.start, end: query.start + label.length, all: true }
          : { start: query.start, end: query.start + label.length, userId: s.person.userId };
    const insert = `${label} `;
    const replaceEnd = caret;
    const text = value.text.slice(0, query.start) + insert + value.text.slice(replaceEnd);
    const shift = insert.length - (replaceEnd - query.start);
    const mentions = value.mentions
      .map((m) => (m.start >= replaceEnd ? { ...m, start: m.start + shift, end: m.end + shift } : m))
      .concat(range)
      .sort((a, b) => a.start - b.start);
    const nextCaret = query.start + insert.length;
    pendingCaret.current = nextCaret;
    setCaretState(nextCaret);
    setActive(0);
    onValueChange({ text, mentions });
    taRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showList && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = suggestions.length;
        setActive((i) => (Math.min(i, n - 1) + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        choose(suggestions[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(query?.start ?? null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  // Backdrop: same text, mentions marked, invisible glyphs.
  const backdrop = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    const anchorAt = showList && query ? query.start : -1;
    const pushText = (from: number, to: number) => {
      if (anchorAt >= from && anchorAt < to) {
        parts.push(value.text.slice(from, anchorAt));
        parts.push(<span key="anchor" ref={anchorRef} />);
        parts.push(value.text.slice(anchorAt, to));
      } else {
        parts.push(value.text.slice(from, to));
      }
    };
    for (const m of value.mentions) {
      pushText(last, m.start);
      parts.push(
        <mark key={`${m.start}-${m.userId ?? m.taskId ?? "all"}`} className="rounded-[4px] bg-accent-blue-soft text-transparent">
          {value.text.slice(m.start, m.end)}
        </mark>,
      );
      last = m.end;
    }
    pushText(last, value.text.length);
    parts.push("​"); // keeps a trailing newline's height
    return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
  }, [value, showList, query]);

  return (
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <div
        ref={backdropRef}
        aria-hidden
        className={cn(
          className,
          "pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap text-transparent select-none [overflow-wrap:anywhere]",
        )}
      >
        {backdrop}
      </div>
      <textarea
        {...rest}
        ref={taRef}
        value={value.text}
        // Stays a native (multi-line) textbox; the list is announced via
        // aria-activedescendant and the live region below.
        aria-autocomplete="list"
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={showList ? `${listId}-${activeIndex}` : undefined}
        onChange={(e) => {
          const el = e.target;
          const next = applyEditorChange(value.text, el.value, value.mentions);
          if (next.caret !== null) pendingCaret.current = next.caret;
          setCaretState(next.caret ?? (el.selectionStart === el.selectionEnd ? el.selectionStart : null));
          setActive(0);
          if (dismissedAt !== null && !activeQuery(next, el.selectionStart)) setDismissedAt(null);
          onValueChange({ text: next.text, mentions: next.mentions });
        }}
        onSelect={syncCaret}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          setCaretState(null);
          onBlur?.(e);
        }}
        onScroll={(e) => {
          if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        className={cn(className, "relative bg-transparent [overflow-wrap:anywhere]")}
      />
      <span className="sr-only" aria-live="polite">
        {showList
          ? `${suggestions.length} ${
              trigger === "#"
                ? suggestions.length === 1 ? "Aufgabe" : "Aufgaben"
                : suggestions.length === 1 ? "Vorschlag" : "Vorschläge"
            } gefunden. Pfeiltasten zum Auswählen, Enter zum Einfügen.`
          : ""}
      </span>
      {showList &&
        pos &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-label={trigger === "#" ? "Aufgabe verlinken" : "Personen erwähnen"}
            style={{
              left: pos.left,
              top: pos.top,
              width: Math.min(listWidth, window.innerWidth - 2 * GUTTER),
              transform: pos.placement === "above" ? "translateY(-100%)" : undefined,
            }}
            className="fixed z-50 max-h-80 overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-raised ring-1 ring-foreground/10 duration-100 animate-in fade-in-0 zoom-in-95"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.kind === "issue" ? s.issue.id : s.kind === "all" ? "all" : s.person.userId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // Keep focus (and the mobile keyboard) in the textarea.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== activeIndex && setActive(i)}
                onClick={() => choose(s)}
                className={cn(
                  "flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm select-none",
                  i === activeIndex && "bg-surface-subtle",
                )}
              >
                {s.kind === "all" ? (
                  <>
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-blue-soft text-xs font-semibold text-accent-blue-text"
                    >
                      @
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{MENTION_ALL_LABEL}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">Alle in dieser Unterhaltung</span>
                    </span>
                  </>
                ) : s.kind === "issue" ? (
                  <>
                    <StatusIcon status={s.issue.status as TaskStatus} />
                    <span className="min-w-9 shrink-0 text-muted-foreground tabular-nums">
                      {formatIssueNumber(s.issue.number)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.issue.title}</span>
                  </>
                ) : (
                  <>
                    <MemberAvatar member={s.person} size="sm" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{displayName(s.person)}</span>
                      {s.person.fullName && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{s.person.email.split("@")[0]}</span>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
});
