import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/** Cloudflare Access settings required to verify an assertion. */
export type CfAccessEnv = Readonly<{
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ISS?: string;
}>;

type AccessTokenVerifier = (token: string, env: CfAccessEnv) => Promise<JWTPayload>;

const remoteJwkSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function verifyToken(token: string, env: CfAccessEnv): Promise<JWTPayload> {
  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_ISS) {
    throw new Error("Cloudflare Access issuer and audience must both be configured.");
  }
  let jwks = remoteJwkSets.get(env.CF_ACCESS_ISS);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.CF_ACCESS_ISS}/cdn-cgi/access/certs`));
    remoteJwkSets.set(env.CF_ACCESS_ISS, jwks);
  }
  return (await jwtVerify(token, jwks, {
    issuer: env.CF_ACCESS_ISS,
    audience: env.CF_ACCESS_AUD,
  })).payload;
}

/** Returns verified Cloudflare Access claims, or null when the assertion cannot be trusted. */
export async function verifyCfAccessJwt(
    request: Request,
    env: CfAccessEnv,
    verifier: AccessTokenVerifier = verifyToken): Promise<JWTPayload | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    return await verifier(token, env);
  } catch {
    return null;
  }
}

/** Returns a privacy-preserving limiter key derived only from verified Access claims. */
export async function accessRateLimitKey(payload: JWTPayload): Promise<string | null> {
  if (payload.sub) return `access-sub:${payload.sub}`;
  if (typeof payload.email !== "string" || payload.email.length === 0) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.email));
  return `access-email:${new Uint8Array(digest).toHex()}`;
}

/**
 * Raw `ACCESS_SERVICE_TOKEN_EMAILS` value: a JSON object mapping an Access service token's client
 * id to the email of the user it acts as. Accepts a JSON binding (already an object) or the same
 * object as a JSON string, the way `ADMINS` does.
 */
export type AccessServiceTokenEmailsSetting = Record<string, string> | string | undefined;

/**
 * Parses `ACCESS_SERVICE_TOKEN_EMAILS` into a client id -> email map. Anything malformed yields no
 * mappings (and a warning through `warn`), so a bad value can only fail closed.
 */
export function parseAccessServiceTokenEmails(
    raw: unknown,
    warn: (message: string) => void = () => {}): Map<string, string> {
  const mappings = new Map<string, string>();
  if (raw === undefined || raw === null || raw === "") return mappings;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      warn("ACCESS_SERVICE_TOKEN_EMAILS is not valid JSON; ignoring it.");
      return mappings;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warn("ACCESS_SERVICE_TOKEN_EMAILS must be a JSON object of client id to email; ignoring it.");
    return mappings;
  }
  for (const [clientId, email] of Object.entries(value)) {
    if (clientId.length === 0 || typeof email !== "string" || email.length === 0) {
      warn("ACCESS_SERVICE_TOKEN_EMAILS has an entry without a client id or email; ignoring it.");
      continue;
    }
    mappings.set(clientId, email);
  }
  return mappings;
}

/**
 * Returns the email a verified Access assertion authenticates as. A user's assertion carries the
 * email directly. A service token's assertion carries no email, only `common_name` (the token's
 * client id); it authenticates as the mapped user when that client id is a key of
 * `serviceTokenEmails`, and as nobody otherwise.
 */
export function accessSessionEmail(
    payload: JWTPayload,
    serviceTokenEmails: ReadonlyMap<string, string>): string | null {
  if (typeof payload.email === "string" && payload.email.length > 0) return payload.email;
  const commonName = payload.common_name;
  if (typeof commonName !== "string" || commonName.length === 0) return null;
  return serviceTokenEmails.get(commonName) ?? null;
}
