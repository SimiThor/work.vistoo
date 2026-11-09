CREATE TYPE "public"."decision_history_kind" AS ENUM('concluded', 'edited', 'reopened', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('open', 'in_discussion', 'decided', 'superseded', 'planned', 'testing', 'adopted', 'rejected', 'inconclusive');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('decision', 'experiment');--> statement-breakpoint
CREATE TABLE "decision_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"kind" "decision_history_kind" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_links_url_web" CHECK ("decision_links"."url" ~* '^https?://'),
	CONSTRAINT "decision_links_url_len" CHECK (char_length("decision_links"."url") <= 2048),
	CONSTRAINT "decision_links_title_len" CHECK ("decision_links"."title" is null or char_length("decision_links"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "decision_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"task_id" uuid,
	"idea_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_relations_one_target" CHECK (num_nonnulls("decision_relations"."task_id", "decision_relations"."idea_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "decision_type" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "decision_status" NOT NULL,
	"assignee_id" uuid,
	"created_by" uuid NOT NULL,
	"options_considered" text DEFAULT '' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"test_description" text DEFAULT '' NOT NULL,
	"results" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"reasoning" text DEFAULT '' NOT NULL,
	"concluded_on" date,
	"superseded_by_id" uuid,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, title || ' ' || description || ' ' || options_considered || ' ' || objective || ' ' || test_description || ' ' || results || ' ' || outcome || ' ' || reasoning)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "decisions_status_matches_type" CHECK (("decisions"."type" = 'decision' and "decisions"."status" in ('open', 'in_discussion', 'decided', 'superseded'))
        or ("decisions"."type" = 'experiment' and "decisions"."status" in ('planned', 'testing', 'adopted', 'rejected', 'inconclusive'))),
	CONSTRAINT "decisions_title_len" CHECK (char_length("decisions"."title") between 1 and 300),
	CONSTRAINT "decisions_text_len" CHECK (char_length("decisions"."description") <= 20000 and char_length("decisions"."options_considered") <= 20000
        and char_length("decisions"."objective") <= 20000 and char_length("decisions"."test_description") <= 20000
        and char_length("decisions"."results") <= 20000 and char_length("decisions"."outcome") <= 20000
        and char_length("decisions"."reasoning") <= 20000),
	CONSTRAINT "decisions_concluded_complete" CHECK (case when "decisions"."status" in ('decided', 'superseded', 'adopted', 'rejected', 'inconclusive')
        then "decisions"."concluded_on" is not null and btrim("decisions"."reasoning") <> ''
          and (btrim("decisions"."outcome") <> '' or ("decisions"."type" = 'experiment' and btrim("decisions"."results") <> ''))
        else "decisions"."concluded_on" is null end),
	CONSTRAINT "decisions_superseded_link" CHECK (("decisions"."status" = 'superseded') = ("decisions"."superseded_by_id" is not null)),
	CONSTRAINT "decisions_not_self_superseded" CHECK ("decisions"."superseded_by_id" is null or "decisions"."superseded_by_id" <> "decisions"."id")
);
--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workspace_id_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "decision_history" ADD CONSTRAINT "decision_history_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_history" ADD CONSTRAINT "decision_history_decision_fk" FOREIGN KEY ("workspace_id","decision_id") REFERENCES "public"."decisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_links" ADD CONSTRAINT "decision_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_links" ADD CONSTRAINT "decision_links_decision_fk" FOREIGN KEY ("workspace_id","decision_id") REFERENCES "public"."decisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_relations" ADD CONSTRAINT "decision_relations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_relations" ADD CONSTRAINT "decision_relations_decision_fk" FOREIGN KEY ("workspace_id","decision_id") REFERENCES "public"."decisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_relations" ADD CONSTRAINT "decision_relations_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_relations" ADD CONSTRAINT "decision_relations_idea_fk" FOREIGN KEY ("workspace_id","idea_id") REFERENCES "public"."ideas"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_assignee_fk" FOREIGN KEY ("workspace_id","assignee_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_superseded_by_fk" FOREIGN KEY ("workspace_id","superseded_by_id") REFERENCES "public"."decisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_history_decision_idx" ON "decision_history" USING btree ("decision_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_links_decision_idx" ON "decision_links" USING btree ("decision_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_relations_task_uq" ON "decision_relations" USING btree ("decision_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_relations_idea_uq" ON "decision_relations" USING btree ("decision_id","idea_id");--> statement-breakpoint
CREATE INDEX "decision_relations_task_idx" ON "decision_relations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "decision_relations_idea_idx" ON "decision_relations" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "decisions_workspace_updated_idx" ON "decisions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "decisions_workspace_created_idx" ON "decisions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_superseded_by_idx" ON "decisions" USING btree ("superseded_by_id");--> statement-breakpoint
CREATE INDEX "decisions_search_idx" ON "decisions" USING gin ("search");