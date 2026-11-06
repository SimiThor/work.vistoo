import "server-only";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import http2 from "node:http2";

/**
 * Minimal APNs client (HTTP/2 + token-based auth with a .p8 key), no extra
 * dependencies. Configuration (Vercel env, never in the repo):
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (contents of the .p8, "\n" escapes allowed),
 *   APNS_BUNDLE_ID (default de.vistoo.work).
 * Without configuration, pushes are skipped (logged once).
 *
 * Each device token carries its environment: Xcode builds use the sandbox
 * gateway, TestFlight/App Store builds production.
 */

export type PushEnvironment = "sandbox" | "production";

export type PushMessage = {
  title: string;
  subtitle?: string;
  body: string;
  /** Groups notifications (conversation id or "tasks"). */
  threadId: string;
  /** Opened in the app on tap. */
  link: { conversationId: string } | { taskId: string };
};

export type PushResult = "sent" | "unregistered" | "failed";

export type PushTransport = (token: string, environment: PushEnvironment, message: PushMessage) => Promise<PushResult>;

type Config = { keyId: string; teamId: string; key: KeyObject; topic: string };

let warned = false;
function config(): Config | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID ?? process.env.APPLE_TEAM_ID;
  const pem = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!keyId || !teamId || !pem) {
    if (!warned) console.warn("[push] APNs not configured (APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY); skipping pushes.");
    warned = true;
    return null;
  }
  return { keyId, teamId, key: createPrivateKey(pem), topic: process.env.APNS_BUNDLE_ID ?? process.env.IOS_BUNDLE_ID ?? "de.vistoo.work" };
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** Provider token, reused for 50 minutes (Apple accepts 20–60). */
let cachedJwt: { value: string; at: number } | null = null;
function providerToken(c: Config): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.at < 50 * 60) return cachedJwt.value;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: c.keyId }));
  const claims = b64url(JSON.stringify({ iss: c.teamId, iat: now }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: c.key, dsaEncoding: "ieee-p1363" });
  cachedJwt = { value: `${header}.${claims}.${b64url(signature)}`, at: now };
  return cachedJwt.value;
}

export function apnsPayload(message: PushMessage) {
  return {
    aps: {
      alert: { title: message.title, ...(message.subtitle ? { subtitle: message.subtitle } : {}), body: message.body },
      sound: "default",
      "thread-id": message.threadId,
    },
    vistoo: message.link,
  };
}

const apnsTransport: PushTransport = async (token, environment, message) => {
  const c = config();
  if (!c) return "failed";
  const host = environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const client = http2.connect(host);
  try {
    return await new Promise<PushResult>((resolve) => {
      client.on("error", () => resolve("failed"));
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${providerToken(c)}`,
        "apns-topic": c.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
      let status = 0;
      let body = "";
      req.setTimeout(10_000, () => req.close());
      req.on("response", (headers) => (status = Number(headers[":status"])));
      req.on("data", (chunk) => (body += chunk));
      req.on("error", () => resolve("failed"));
      req.on("close", () => {
        if (status === 200) return resolve("sent");
        // Token no longer valid for this app/environment → forget it.
        if (status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(body)) return resolve("unregistered");
        console.error(`[push] APNs ${status}: ${body.slice(0, 200)}`);
        resolve("failed");
      });
      req.end(JSON.stringify(apnsPayload(message)));
    });
  } finally {
    client.close();
  }
};

let transport: PushTransport = apnsTransport;

/** Test hook. */
export function setPushTransportForTests(t: PushTransport | null) {
  transport = t ?? apnsTransport;
}

export function deliver(token: string, environment: PushEnvironment, message: PushMessage): Promise<PushResult> {
  return transport(token, environment, message);
}
