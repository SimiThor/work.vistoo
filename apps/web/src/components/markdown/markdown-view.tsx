"use client";

import { lazy, Suspense, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Parser + highlighter live in their own chunk, loaded when a description is shown.
const Renderer = lazy(() => import("./markdown-renderer"));

export const loadMarkdownRenderer = () => import("./markdown-renderer");

type Props = ComponentProps<typeof import("./markdown-renderer").default>;

/** Rendered Markdown (GFM) with optional interactive checklists. Lazy-loaded. */
export function MarkdownView(props: Props) {
  return (
    <Suspense
      fallback={
        // Source text until the renderer chunk is there: no jump to empty.
        <div className={cn("text-sm leading-relaxed whitespace-pre-wrap text-foreground", props.className)}>
          {props.source}
        </div>
      }
    >
      <Renderer {...props} />
    </Suspense>
  );
}
