import "@/server/background";
import { handleApiRequest } from "@vistoo/backend/http";

/**
 * Versioned HTTP API for native clients (contract: packages/contracts,
 * OpenAPI: packages/contracts/generated/openapi.json).
 *
 * All logic lives in @vistoo/backend: bearer-token identity, membership and
 * role checks on every request, the same services as the web's Server Actions.
 * Nothing here is cached; every response is user-specific.
 */
const handle = (request: Request) => handleApiRequest(request);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
