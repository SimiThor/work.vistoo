import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyFilters, EMPTY_FILTERS, type Filters } from "../src/filters";
import type { TaskStatus } from "../src/constants";

type Fixture = {
  tasks: { id: string; number?: number; title: string; projectId: string; assigneeId: string | null; status: string }[];
  cases: { name: string; filters: Partial<Filters>; expected: string[] }[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../contracts/fixtures/task-filters.json"), "utf8"),
);

describe("task filters (shared conformance cases, also run by the iOS tests)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const tasks = fixture.tasks.map((t) => ({ ...t, status: t.status as TaskStatus }));
      const result = applyFilters(tasks, { ...EMPTY_FILTERS, ...c.filters }).map((t) => t.id);
      expect(result).toEqual(c.expected);
    });
  }
});
