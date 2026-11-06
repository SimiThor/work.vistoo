import "server-only";
import { z } from "zod";
import { API_BASE_PATH, API_VERSION, endpoints, type EndpointDef, type OperationId } from "@vistoo/contracts";
import { ERROR_HTTP_STATUS } from "@vistoo/contracts/openapi";
import { accessRevoked, assertAdmin, resolveMembership, sessionExpired, verifyAccessToken } from "../auth";
import { AppError, toErrorBody } from "../errors";
import { handlers, minimumIosBuild } from "./handlers";

/**
 * Framework-agnostic dispatcher for the versioned HTTP API. Takes a standard
 * Request, returns a standard Response (mounted by apps/web as a catch-all
 * Route Handler at /api/v1/[...path]).
 *
 * Per request:
 *   1. match method + path against the contract,
 *   2. reject outdated iOS builds (CLIENT_OUTDATED),
 *   3. verify the bearer token → identity; re-check the ACTIVE membership
 *      and role in the database (removed members lose access immediately),
 *   4. validate params / query / body with the contract schemas,
 *   5. call the shared service, serialize, map errors.
 */

type Route = { operationId: OperationId; def: EndpointDef; pattern: RegExp; keys: string[] };

const routes: Route[] = (Object.entries(endpoints) as [OperationId, EndpointDef][]).map(([operationId, def]) => {
  const keys: string[] = [];
  // Contract paths only contain letters, "-", "/" and {param} placeholders.
  const pattern = new RegExp(
    `^${def.path.replace(/\{(\w+)\}/g, (_m, key: string) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  return { operationId, def, pattern, keys };
});

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-vistoo-api-version": API_VERSION,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(err: unknown): Response {
  const body = toErrorBody(err);
  return json(ERROR_HTTP_STATUS[body.code] ?? 500, { error: body });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/** "ios/<build>" → build number (other clients are not version-gated). */
function iosBuild(request: Request): number | null {
  const m = /^ios\/(\d+)/i.exec(request.headers.get("x-vistoo-client") ?? "");
  return m ? Number(m[1]) : null;
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", "Ungültige Anfrage (kein gültiges JSON).");
  }
}

function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.startsWith(API_BASE_PATH) ? url.pathname.slice(API_BASE_PATH.length) || "/" : url.pathname;
  const method = request.method.toUpperCase();

  let matched: { route: Route; match: RegExpExecArray } | null = null;
  let pathExists = false;
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    pathExists = true;
    if (route.def.method === method) {
      matched = { route, match };
      break;
    }
  }
  if (!matched) {
    return pathExists
      ? json(405, { error: { code: "VALIDATION", message: "Methode nicht erlaubt." } })
      : json(404, { error: { code: "NOT_FOUND", message: "Unbekannter Endpunkt." } });
  }
  const { route, match } = matched;
  const { def, operationId } = route;

  try {
    const build = iosBuild(request);
    if (operationId !== "getMeta" && build !== null && build < minimumIosBuild()) {
      throw new AppError("CLIENT_OUTDATED", "Bitte aktualisiere die Vistoo-App, um weiterzuarbeiten.");
    }

    // Identity and authorization (never from request ids).
    let ctx: unknown = null;
    if (def.auth !== "public") {
      const token = bearerToken(request);
      const user = token ? await verifyAccessToken(token) : null;
      if (!user) throw sessionExpired();
      if (def.auth === "session") {
        ctx = user;
      } else {
        const membership = await resolveMembership(user);
        if (!membership) throw accessRevoked();
        if (def.auth === "admin") assertAdmin(membership);
        ctx = membership;
      }
    }

    const rawParams = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const input = {
      params: def.params ? def.params.parse(rawParams) : undefined,
      query: def.query ? def.query.parse(queryObject(url)) : undefined,
      body: def.body ? def.body.parse(await readBody(request)) : undefined,
    };

    const handler = handlers[operationId] as (ctx: unknown, input: unknown) => Promise<unknown>;
    const result = await handler(ctx, input);

    if (!def.response) return new Response(null, { status: 204, headers: { "x-vistoo-api-version": API_VERSION } });
    // Outside production, every response is checked against the contract.
    const payload = process.env.NODE_ENV === "production" ? result : assertContract(def.response, result, operationId);
    return json(def.status ?? 200, payload);
  } catch (err) {
    return errorResponse(err);
  }
}

function assertContract(schema: z.ZodType, value: unknown, operationId: string): unknown {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Response of ${operationId} violates the API contract: ${parsed.error.message}`);
  }
  return value;
}
