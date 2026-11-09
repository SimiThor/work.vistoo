-- Project groups are removed completely (decision 2026-11-09): tasks lose
-- their group assignment, the groups themselves are deleted. API v1 keeps
-- `Task.groupId` (always null) and `Project.groups` (always empty) so
-- installed iOS builds keep decoding responses.
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_group_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_group_idx";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "group_id";--> statement-breakpoint
DROP TABLE IF EXISTS "project_groups";
