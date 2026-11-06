import { Skeleton } from "@/components/ui/skeleton";

/** Matches the WorkView layout to avoid layout shifts while loading. */
export function WorkSkeleton({ title }: { title?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Aufgaben werden geladen">
      <div className="shrink-0 space-y-4 px-4 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div className="flex h-7 items-center justify-between">
          {title ? <h1 className="text-xl font-semibold tracking-tight">{title}</h1> : <Skeleton className="h-6 w-48" />}
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-56 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      </div>
      <div className="flex gap-3 overflow-hidden px-4 sm:px-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-[84vw] max-w-[320px] shrink-0 space-y-2 sm:w-auto sm:max-w-none sm:min-w-[260px] sm:flex-1 sm:basis-0 rounded-xl bg-surface-subtle p-2">
            <Skeleton className="m-1 h-5 w-24 bg-surface-sunken" />
            {Array.from({ length: 3 - (i % 2) }, (_, j) => (
              <Skeleton key={j} className="h-[76px] w-full bg-background" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
