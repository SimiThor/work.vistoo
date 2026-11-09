import { z } from "zod";
import { apiRegistry } from "@vistoo/domain/dto";
import type { ErrorCode } from "@vistoo/domain/result";
import { API_BASE_PATH, API_VERSION, endpoints, requestRegistry, type EndpointDef } from "./endpoints";

/** HTTP status per error code. Part of the contract (server and clients rely on it). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  ARCHIVED: 409,
  LAST_ADMIN: 409,
  RATE_LIMITED: 429,
  CLIENT_OUTDATED: 426,
  INTERNAL: 500,
};

type Json = Record<string, unknown>;
const REF_PREFIX = "#/components/schemas/";

/** Removes noise that does not belong into a component (and regex patterns already implied by `format`). */
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [k, value] of Object.entries(node as Json)) {
    if (k === "$schema" || k === "$id") continue;
    if (k === "pattern" && typeof (node as Json).format === "string") continue;
    out[k] = clean(value);
  }
  return out;
}

function componentSchemas(): Record<string, unknown> {
  const uri = (id: string) => `${REF_PREFIX}${id}`;
  const responses = z.toJSONSchema(apiRegistry, { target: "draft-2020-12", io: "output", uri }).schemas;
  const requests = z.toJSONSchema(requestRegistry, { target: "draft-2020-12", io: "input", uri }).schemas;
  const all: Record<string, unknown> = {};
  for (const [id, schema] of [...Object.entries(responses), ...Object.entries(requests)]) {
    if (all[id]) throw new Error(`Duplicate component name: ${id}`);
    all[id] = clean(schema);
  }
  return Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
}

function refFor(schema: z.ZodType, registry: typeof apiRegistry | typeof requestRegistry): Json {
  const id = registry.get(schema)?.id;
  if (!id) throw new Error("Endpoint schema without registered name; wrap it in req()/res().");
  return { $ref: `${REF_PREFIX}${id}` };
}

function parameters(def: EndpointDef): Json[] {
  const out: Json[] = [];
  const add = (where: "path" | "query", obj: z.ZodObject | undefined) => {
    if (!obj) return;
    for (const [name, prop] of Object.entries(obj.shape)) {
      const schema = clean(z.toJSONSchema(prop as z.ZodType, { target: "draft-2020-12", io: "input" })) as Json;
      const optional = (prop as z.ZodType).safeParse(undefined).success;
      out.push({ name, in: where, required: where === "path" || !optional, schema });
    }
  };
  add("path", def.params);
  add("query", def.query);
  return out;
}

function errorResponses(def: EndpointDef): Json {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of [...def.errors, "CLIENT_OUTDATED", "INTERNAL"] as ErrorCode[]) {
    const status = ERROR_HTTP_STATUS[code];
    byStatus.set(status, [...new Set([...(byStatus.get(status) ?? []), code])]);
  }
  return Object.fromEntries(
    [...byStatus.entries()]
      .sort(([a], [b]) => a - b)
      .map(([status, codes]) => [
        String(status),
        {
          description: `Error codes: ${codes.join(", ")}`,
          content: { "application/json": { schema: { $ref: `${REF_PREFIX}ErrorResponse` } } },
        },
      ]),
  );
}

export function buildOpenApiDocument(): Json {
  const paths: Record<string, Json> = {};
  for (const [operationId, def] of Object.entries(endpoints) as [string, EndpointDef][]) {
    const success = def.response
      ? {
          [String(def.status ?? 200)]: {
            description: "OK",
            content: { "application/json": { schema: refFor(def.response, apiRegistry) } },
          },
        }
      : { "204": { description: "No Content" } };
    const op: Json = {
      operationId,
      tags: [def.tag],
      summary: def.summary,
      ...(def.description ? { description: def.description } : {}),
      security: def.auth === "public" ? [] : [{ bearerAuth: [] }],
      "x-vistoo-auth": def.auth,
      "x-vistoo-retry": def.retry,
      parameters: parameters(def),
      ...(def.body
        ? { requestBody: { required: true, content: { "application/json": { schema: refFor(def.body, requestRegistry) } } } }
        : {}),
      responses: { ...success, ...errorResponses(def) },
    };
    (paths[def.path] ??= {})[def.method.toLowerCase()] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Vistoo Work API",
      version: API_VERSION,
      description: [
        "Versioned HTTP API for native clients. Generated from packages/contracts — do not edit by hand.",
        "",
        "Authentication: `Authorization: Bearer <Supabase access token>`. Identity comes from the verified token;",
        "workspace membership and role are re-checked on every request.",
        "",
        "Clients identify themselves with `X-Vistoo-Client: ios/<build number>`.",
        "Instants are ISO 8601 UTC with milliseconds; calendar days are YYYY-MM-DD.",
        "Nullable fields are always present. Enums are open: clients must tolerate unknown values.",
        "See docs/api/README.md for errors, pagination, retries and compatibility rules.",
      ].join("\n"),
    },
    servers: [{ url: API_BASE_PATH }],
    tags: ["Meta", "Session", "Tasks", "Projects", "Milestones", "Todos", "Ideas", "CRM", "Decisions", "Team", "Chat", "Files"].map((name) => ({ name })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: componentSchemas(),
    },
  };
}
