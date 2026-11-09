/**
 * TLS for every Postgres connection (app, migrations, scripts).
 *
 * postgres.js connects WITHOUT encryption unless told otherwise, and the
 * Supabase pooler does not enforce TLS by default. Without this module, every
 * query and result (chat messages, tasks, CRM data …) would cross the network
 * between Vercel and Supabase in plaintext.
 *
 * Rules (first match wins):
 *   1. `sslmode` in the URL or PGSSLMODE in the environment: respected as is.
 *   2. Local hosts (localhost, 127.0.0.1, ::1, Unix socket): no TLS.
 *   3. DATABASE_SSL_CA set (PEM): TLS, certificate and host name verified against it.
 *   4. Supabase hosts (*.supabase.com / *.supabase.co): TLS, verified against the
 *      bundled Supabase Root 2021 CA (below).
 *   5. Any other remote host: TLS required (encrypted, certificate not verified).
 */

/**
 * Supabase Root 2021 CA (public certificate, valid until 2031-04-26). Identical
 * to the CA Supabase publishes for its databases and pooler (dashboard →
 * Database Settings → SSL Configuration, file `prod-ca-2021.crt`).
 * SHA-256: 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 */
export const SUPABASE_ROOT_CA_2021 = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

export type DatabaseSsl = "require" | { ca: string; rejectUnauthorized: true };

/** `postgres:` is a non-special URL scheme: `postgres:///db` keeps an empty host (unlike `http:`). */
export function parseDatabaseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Host part of a connection URL; "" for Unix sockets (`postgres:///db`). */
export function databaseHost(url: string): string {
  return parseDatabaseUrl(url)?.hostname.replace(/^\[|\]$/g, "").toLowerCase() ?? "";
}

export function isLocalDatabaseHost(host: string): boolean {
  return host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/");
}

/**
 * The `ssl` option to pass to postgres.js, or `undefined` when the URL or the
 * environment already decides (or the host is local).
 */
export function databaseSsl(url: string, env: NodeJS.ProcessEnv = process.env): DatabaseSsl | undefined {
  const parsed = parseDatabaseUrl(url);
  if (parsed?.searchParams.has("sslmode") || parsed?.searchParams.has("ssl") || env.PGSSLMODE || env.PGSSL) {
    return undefined;
  }
  // No host in the URL: postgres.js falls back to PGHOST (socket path or host name).
  const host = databaseHost(url) || (env.PGHOST ?? "").toLowerCase();
  if (isLocalDatabaseHost(host)) return undefined;
  const customCa = env.DATABASE_SSL_CA?.replace(/\\n/g, "\n").trim();
  if (customCa) return { ca: customCa, rejectUnauthorized: true };
  if (host.endsWith(".supabase.com") || host.endsWith(".supabase.co")) {
    return { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true };
  }
  return "require";
}

/** postgres.js options fragment: `{ ssl }` only when TLS has to be switched on here. */
export function databaseTlsOptions(url: string, env: NodeJS.ProcessEnv = process.env): { ssl?: DatabaseSsl } {
  const ssl = databaseSsl(url, env);
  return ssl === undefined ? {} : { ssl };
}
