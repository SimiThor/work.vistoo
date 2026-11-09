-- Ideas only know "Neu", "Geplant" and "Irrelevant" (decision 2026-11-09).
-- Existing data: "In Prüfung" → "Neu", "Archiviert" → "Irrelevant".
ALTER TABLE "ideas" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."idea_status" RENAME TO "idea_status_old";--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'planned', 'irrelevant');--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "status" TYPE "public"."idea_status" USING (
  CASE "status"::text
    WHEN 'considering' THEN 'new'
    WHEN 'archived' THEN 'irrelevant'
    ELSE "status"::text
  END
)::"public"."idea_status";--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "status" SET DEFAULT 'new';--> statement-breakpoint
DROP TYPE "public"."idea_status_old";
