import type { Metadata } from "next";
import { Suspense } from "react";
import { TodoList } from "@/components/todos/todo-list";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/server/queries";
import { listTodos } from "@vistoo/backend/services/todos";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Meine To-dos" };

export default function TodosPage() {
  return (
    <PageShell>
      <Suspense fallback={<TodosSkeleton />}>
        <Todos />
      </Suspense>
    </PageShell>
  );
}

async function Todos() {
  const { ctx } = await getViewer();
  return <TodoList initial={await listTodos(ctx)} />;
}

function TodosSkeleton() {
  return (
    <div aria-busy="true" aria-label="To-dos werden geladen">
      <h1 className="text-xl font-semibold tracking-tight">Meine To-dos</h1>
      <Skeleton className="mt-6 h-12 w-full rounded-xl" />
      <div className="mt-4 space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-2/3" />
        ))}
      </div>
    </div>
  );
}
