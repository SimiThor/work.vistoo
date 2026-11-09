-- Additive only: new table, nullable column, a unique constraint on (workspace_id, id)
-- of tasks (always satisfied: id is the primary key). No existing data changes.
CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_links_url_web" CHECK ("task_links"."url" ~* '^https?://'),
	CONSTRAINT "task_links_url_len" CHECK (char_length("task_links"."url") <= 2048),
	CONSTRAINT "task_links_title_len" CHECK ("task_links"."title" is null or char_length("task_links"."title") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_links_task_idx" ON "task_links" USING btree ("task_id","created_at");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_meeting_url_web" CHECK ("workspaces"."meeting_url" is null or "workspaces"."meeting_url" ~* '^https?://');--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_meeting_url_len" CHECK ("workspaces"."meeting_url" is null or char_length("workspaces"."meeting_url") <= 2048);