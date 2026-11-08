CREATE TYPE "public"."attraction_activity_type" AS ENUM('call', 'email', 'meeting', 'note', 'created', 'status_changed', 'owner_changed', 'follow_up_changed');--> statement-breakpoint
CREATE TYPE "public"."attraction_status" AS ENUM('new', 'contacted', 'interested', 'in_discussion', 'partner', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'considering', 'planned', 'archived');--> statement-breakpoint
CREATE TABLE "attraction_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"attraction_id" uuid NOT NULL,
	"type" "attraction_activity_type" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attraction_activities_description_len" CHECK (char_length("attraction_activities"."description") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "attractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"country" text,
	"website" text,
	"email" text,
	"contact_name" text,
	"status" "attraction_status" DEFAULT 'new' NOT NULL,
	"owner_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"next_follow_up" date,
	"last_contact_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attractions_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "attractions_name_len" CHECK (char_length("attractions"."name") between 1 and 200),
	CONSTRAINT "attractions_short_text_len" CHECK (coalesce(char_length("attractions"."city"), 0) <= 200 and coalesce(char_length("attractions"."country"), 0) <= 200
        and coalesce(char_length("attractions"."contact_name"), 0) <= 200 and coalesce(char_length("attractions"."email"), 0) <= 2048),
	CONSTRAINT "attractions_website_web" CHECK ("attractions"."website" is null or ("attractions"."website" ~* '^https?://' and char_length("attractions"."website") <= 2048)),
	CONSTRAINT "attractions_notes_len" CHECK (char_length("attractions"."notes") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "idea_status" DEFAULT 'new' NOT NULL,
	"created_by" uuid NOT NULL,
	"assignee_id" uuid,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ideas_title_len" CHECK (char_length("ideas"."title") between 1 and 300),
	CONSTRAINT "ideas_description_len" CHECK (char_length("ideas"."description") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "personal_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_todos_title_len" CHECK (char_length("personal_todos"."title") between 1 and 300),
	CONSTRAINT "personal_todos_description_len" CHECK (char_length("personal_todos"."description") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "attraction_activities" ADD CONSTRAINT "attraction_activities_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attraction_activities" ADD CONSTRAINT "attraction_activities_attraction_fk" FOREIGN KEY ("workspace_id","attraction_id") REFERENCES "public"."attractions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attractions" ADD CONSTRAINT "attractions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attractions" ADD CONSTRAINT "attractions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attractions" ADD CONSTRAINT "attractions_owner_fk" FOREIGN KEY ("workspace_id","owner_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_assignee_fk" FOREIGN KEY ("workspace_id","assignee_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_todos" ADD CONSTRAINT "personal_todos_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attraction_activities_timeline_idx" ON "attraction_activities" USING btree ("attraction_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attractions_workspace_idx" ON "attractions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ideas_workspace_created_idx" ON "ideas" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ideas_task_idx" ON "ideas" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "personal_todos_owner_idx" ON "personal_todos" USING btree ("workspace_id","user_id","position");