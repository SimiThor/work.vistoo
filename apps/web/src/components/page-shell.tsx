/**
 * Scrolling page frame with the one content width shared by every list page
 * (ideas, decisions, CRM, to-dos, projects, milestones, settings). Chat and the
 * task board use the full width and do not use it.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>
    </div>
  );
}
