ALTER TABLE "decisions" DROP CONSTRAINT "decisions_concluded_complete";--> statement-breakpoint
-- Experiments now only have description + result. Fold the retired fields into
-- these two so no existing content becomes invisible.
UPDATE "decisions" SET
  "description" = left(concat_ws(E'\n\n',
    nullif(btrim("description"), ''),
    'Ziel: ' || nullif(btrim("objective"), ''),
    'Getestet: ' || nullif(btrim("test_description"), '')), 20000),
  "results" = left(concat_ws(E'\n\n',
    nullif(btrim("results"), ''),
    'Fazit: ' || nullif(btrim("outcome"), ''),
    'Begründung: ' || nullif(btrim("reasoning"), '')), 20000),
  "objective" = '', "test_description" = '', "outcome" = '', "reasoning" = ''
WHERE "type" = 'experiment'
  AND (btrim("objective") <> '' OR btrim("test_description") <> '' OR btrim("outcome") <> '' OR btrim("reasoning") <> '');--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_concluded_complete" CHECK (case when "decisions"."status" in ('decided', 'superseded', 'adopted', 'rejected', 'inconclusive')
        then "decisions"."concluded_on" is not null
          and (case when "decisions"."type" = 'experiment' then btrim("decisions"."results") <> ''
            else btrim("decisions"."outcome") <> '' and btrim("decisions"."reasoning") <> '' end)
        else "decisions"."concluded_on" is null end);