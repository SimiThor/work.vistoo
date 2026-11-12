ALTER TYPE "public"."task_status" ADD VALUE 'backlog' BEFORE 'open';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_assignee_ids_idx" ON "tasks" USING gin ("assignee_ids");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_ids_valid" CHECK (cardinality("tasks"."assignee_ids") <= 20 and array_position("tasks"."assignee_ids", null) is null);