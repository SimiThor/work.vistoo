CREATE TYPE "public"."meeting_agenda_status" AS ENUM('open', 'discussed');--> statement-breakpoint
CREATE TABLE "meeting_agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"assigned_to" uuid,
	"status" "meeting_agenda_status" DEFAULT 'open' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"position" double precision NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_agenda_items_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "meeting_agenda_items_title_len" CHECK (char_length("meeting_agenda_items"."title") between 1 and 300),
	CONSTRAINT "meeting_agenda_items_text_len" CHECK (char_length("meeting_agenda_items"."description") <= 20000 and char_length("meeting_agenda_items"."outcome") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "meeting_agenda_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"task_id" uuid,
	"decision_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_agenda_relations_one_target" CHECK (num_nonnulls("meeting_agenda_relations"."task_id", "meeting_agenda_relations"."decision_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"meeting_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_participants_meeting_id_user_id_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"meeting_url" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "meetings_title_len" CHECK (char_length("meetings"."title") between 1 and 200),
	CONSTRAINT "meetings_description_len" CHECK (char_length("meetings"."description") <= 20000),
	CONSTRAINT "meetings_time_range" CHECK ("meetings"."ends_at" > "meetings"."starts_at" and "meetings"."ends_at" - "meetings"."starts_at" <= interval '24 hours'),
	CONSTRAINT "meetings_url_web" CHECK ("meetings"."meeting_url" is null or ("meetings"."meeting_url" ~* '^https?://' and char_length("meetings"."meeting_url") <= 2048))
);
--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_meeting_fk" FOREIGN KEY ("workspace_id","meeting_id") REFERENCES "public"."meetings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_assignee_fk" FOREIGN KEY ("workspace_id","assigned_to") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_relations" ADD CONSTRAINT "meeting_agenda_relations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_relations" ADD CONSTRAINT "meeting_agenda_relations_item_fk" FOREIGN KEY ("workspace_id","agenda_item_id") REFERENCES "public"."meeting_agenda_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_relations" ADD CONSTRAINT "meeting_agenda_relations_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_relations" ADD CONSTRAINT "meeting_agenda_relations_decision_fk" FOREIGN KEY ("workspace_id","decision_id") REFERENCES "public"."decisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_fk" FOREIGN KEY ("workspace_id","meeting_id") REFERENCES "public"."meetings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_agenda_items_meeting_position_idx" ON "meeting_agenda_items" USING btree ("meeting_id","position");--> statement-breakpoint
CREATE INDEX "meeting_agenda_items_assignee_idx" ON "meeting_agenda_items" USING btree ("workspace_id","assigned_to");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_agenda_relations_task_uq" ON "meeting_agenda_relations" USING btree ("agenda_item_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_agenda_relations_decision_uq" ON "meeting_agenda_relations" USING btree ("agenda_item_id","decision_id");--> statement-breakpoint
CREATE INDEX "meeting_agenda_relations_task_idx" ON "meeting_agenda_relations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "meeting_agenda_relations_decision_idx" ON "meeting_agenda_relations" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "meeting_participants_user_idx" ON "meeting_participants" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "meetings_workspace_starts_idx" ON "meetings" USING btree ("workspace_id","starts_at");