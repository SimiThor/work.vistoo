"use client";

/**
 * Markdown renderer (GitHub Flavored Markdown). Loaded lazily via
 * `markdown-view.tsx` so the parser and highlighter stay out of the main bundle.
 *
 * Security: raw HTML in the source is never rendered (`skipHtml`, no
 * rehype-raw), URLs go through react-markdown's `defaultUrlTransform`
 * (drops `javascript:`, `data:` …), external links open with
 * `noopener noreferrer`. Nothing is injected with dangerouslySetInnerHTML.
 */
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createContext, useContext, useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeHighlight, { type Options as HighlightOptions } from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { listChecklistItems, type ChecklistItem } from "@vistoo/domain/markdown";
import { cn } from "@/lib/utils";

const highlight: HighlightOptions = {
  // Only fenced blocks with a language are highlighted; no guessing, small bundle.
  detect: false,
  languages: { bash, css, diff, javascript, json, markdown, python, sql, swift, typescript, xml, yaml },
  aliases: {
    bash: ["sh", "shell", "zsh", "console"],
    javascript: ["js", "jsx", "mjs", "cjs"],
    typescript: ["ts", "tsx"],
    xml: ["html", "svg"],
    markdown: ["md"],
    yaml: ["yml"],
    python: ["py"],
  },
};

export type ChecklistToggle = (item: ChecklistItem, checked: boolean) => void;

const ItemContext = createContext<ChecklistItem | undefined>(undefined);
const ToggleContext = createContext<{ onToggle?: ChecklistToggle; disabled?: boolean }>({});

function TaskCheckbox({ checked }: { checked?: boolean }) {
  const item = useContext(ItemContext);
  const { onToggle, disabled } = useContext(ToggleContext);
  const interactive = Boolean(onToggle && item && !disabled);
  return (
    <input
      type="checkbox"
      className="md-checkbox"
      checked={item?.checked ?? Boolean(checked)}
      disabled={!interactive}
      aria-label={item ? `${item.text} erledigt` : undefined}
      onChange={(e) => item && onToggle?.(item, e.target.checked)}
    />
  );
}

/** Drops react-markdown's `node` prop so it is not spread onto DOM elements. */
function domProps<P extends { node?: unknown }>(props: P): Omit<P, "node"> {
  const { node, ...rest } = props;
  void node;
  return rest;
}

function isExternal(href: string | undefined): boolean {
  return Boolean(href && /^(https?:)?\/\//i.test(href));
}

export default function MarkdownRenderer({
  source,
  onToggle,
  disabled,
  className,
}: {
  source: string;
  onToggle?: ChecklistToggle;
  disabled?: boolean;
  className?: string;
}) {
  // Same parser as react-markdown: list item start offset ↔ checklist item.
  const byStart = useMemo(() => new Map(listChecklistItems(source).map((i) => [i.itemStart, i])), [source]);

  const components = useMemo<Components>(
    () => ({
      a: (props) => {
        const { href, children, ...rest } = domProps(props);
        return isExternal(href) ? (
          <a {...rest} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        ) : (
          <a {...rest} href={href}>
            {children}
          </a>
        );
      },
      li: ({ node, children, className: cls, ...rest }) => {
        const start = node?.position?.start.offset;
        const item = start !== undefined ? byStart.get(start) : undefined;
        const li = (
          <li {...rest} className={cn(cls, item?.checked && "is-checked")}>
            {children}
          </li>
        );
        return cls?.includes("task-list-item") ? <ItemContext.Provider value={item}>{li}</ItemContext.Provider> : li;
      },
      input: ({ type, checked }) =>
        type === "checkbox" ? <TaskCheckbox checked={checked} /> : null,
      table: (props) => (
        <div className="md-table">
          <table {...domProps(props)} />
        </div>
      ),
      img: ({ src, alt }) =>
        typeof src === "string" && /^https:\/\//i.test(src) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span>{alt}</span>
        ),
    }),
    [byStart],
  );

  return (
    <ToggleContext.Provider value={{ onToggle, disabled }}>
      <div className={cn("markdown-body", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, highlight]]}
          skipHtml
          urlTransform={defaultUrlTransform}
          components={components}
        >
          {source}
        </ReactMarkdown>
      </div>
    </ToggleContext.Provider>
  );
}
