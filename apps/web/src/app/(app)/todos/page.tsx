import type { Metadata } from "next";
import { Suspense } from "react";
import { TodoList } from "@/components/todos/todo-list";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/server/queries";
import { listTodos } from "@vistoo/backend/services/todos";

export const metadata: Metadata = { title: "Meine To-dos" };

export default function TodosPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-6">
        <Suspense fallback={<TodosSkeleton />}>
          <Todos />
        </Suspense>
      </div>
    </div>
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
