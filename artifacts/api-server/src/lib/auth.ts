import jwt from "jsonwebtoken";

const isProd = process.env.NODE_ENV === "production";
const SECRET = process.env["SESSION_SECRET"];
if (!SECRET) {
  if (isProd) {
    throw new Error("SESSION_SECRET is required in production");
  }
  // dev: warn loudly but don't crash so the demo still runs
  // eslint-disable-next-line no-console
  console.warn("[auth] SESSION_SECRET not set — using ephemeral dev secret");
}
const EFFECTIVE_SECRET = SECRET || `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const USER_TTL = "30d";
const ADMIN_TTL = "7d";

export interface UserTokenPayload {
  sub: string;
  kind: "user";
}
export interface AdminTokenPayload {
  sub: string;
  kind: "admin";
}
export type TokenPayload = UserTokenPayload | AdminTokenPayload;

export function signUserToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: "user" } satisfies UserTokenPayload, EFFECTIVE_SECRET, {
    expiresIn: USER_TTL,
  });
}
export function signAdminToken(adminId: string): string {
  return jwt.sign({ sub: adminId, kind: "admin" } satisfies AdminTokenPayload, EFFECTIVE_SECRET, {
    expiresIn: ADMIN_TTL,
  });
}
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, EFFECTIVE_SECRET) as TokenPayload;
    if (
      decoded &&
      (decoded.kind === "user" || decoded.kind === "admin") &&
      typeof decoded.sub === "string"
    ) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}
