/**
 * Apple App Site Association for Universal Links, served at
 * /.well-known/apple-app-site-association (rewrite in next.config.ts).
 *
 * Configured per environment via APPLE_TEAM_ID (+ optional IOS_BUNDLE_ID);
 * without APPLE_TEAM_ID the file does not exist (404), so nothing is claimed.
 *
 * Claimed paths: the iOS login link and shareable task/project/chat links.
 * The web login link (/auth/confirm) is deliberately NOT claimed, so signing
 * in to the website on an iPhone keeps working in the browser.
 */
export async function GET(request: Request) {
  void request.url; // request-time: depends on the deployment's environment
  const teamId = process.env.APPLE_TEAM_ID;
  if (!teamId) return new Response("Not found", { status: 404 });
  const bundleId = process.env.IOS_BUNDLE_ID ?? "de.vistoo.work";
  const appID = `${teamId}.${bundleId}`;
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [appID],
            components: [
              { "/": "/auth/ios/confirm", comment: "Login link requested from the iOS app" },
              { "/": "/tasks", "?": { task: "?*" }, comment: "Shared task link" },
              { "/": "/projects/*", comment: "Project (optionally with ?task=)" },
              { "/": "/chat/*", comment: "Conversation" },
            ],
          },
        ],
      },
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
