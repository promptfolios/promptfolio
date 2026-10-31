import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/** The shortest secret accepted for signing tokens or hashing visitors' addresses. */
export const MIN_SECRET_CHARS = 32;

const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/**
 * The part of an address that identifies one connection, or `undefined` if it is not an address.
 * One IPv6 connection often controls a whole /64 block, so only those first 64 bits count.
 */
export function visitorNetwork(address: string): string | undefined {
  const plain = address.trim().split("%")[0] ?? "";
  const mapped = MAPPED_IPV4.exec(plain)?.[1];
  if (mapped) return mapped;

  const version = isIP(plain);
  if (version === 4) return plain;
  if (version !== 6) return undefined;

  const groupsOf = (part: string | undefined) => (part ? part.split(":") : []);
  const [start, end] = plain.split("::");
  const head = groupsOf(start);
  // A dotted tail stands for two groups; only the count matters, as it is past the first 64 bits.
  const tail = groupsOf(end).flatMap((group) => (group.includes(".") ? ["0", "0"] : [group]));
  const zeros = Array<string>(8 - head.length - tail.length).fill("0");
  return [...head, ...zeros, ...tail]
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":");
}

/**
 * Identifies a visitor by a keyed hash of their IP address, so the store never holds the address.
 * Vercel overwrites these headers, so a client cannot choose them. Another host must do the same.
 * `x-forwarded-for` is the fallback for `next dev` and `next start`. The label keeps each use's
 * hash apart from the others and from any signatures made with the same secret.
 */
export function createVisitorIdentifier(secret: string, label: string) {
  return async (request: Request): Promise<string | undefined> => {
    const header =
      request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
    const network = header ? visitorNetwork(header.split(",")[0] ?? "") : undefined;
    if (!network) return undefined;
    return createHmac("sha256", secret).update(`${label}:${network}`).digest("base64url");
  };
}
