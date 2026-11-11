/*
 * Fetches a profile file from a URL: the owner's published profile.json, or a private store read
 * with a token. This is the only code in the package that does I/O, and it validates nothing: the
 * caller passes `data` to `loadStructuredProfile` (and, if it wants, `findContactDetails`).
 *
 * Every expected failure is a result, not an exception, so a caller can decide what to do. An app
 * that caches the profile should throw on `ok: false` inside its cached function, so a failure is
 * never cached as if it were a profile. Invalid options are a programming error and do throw.
 */

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 512 * 1024,
  userAgent: "promptfolio-source-remote",
} as const;

/** How much of an error response is read, and how much of it is kept in the message. */
const ERROR_BODY = { maxBytes: 4096, maxChars: 300 } as const;
/** Header values shorter than this are not redacted from error text (too likely to be ordinary words). */
const MIN_REDACTED_LENGTH = 8;

export interface FetchRemoteProfileOptions {
  /** An http or https URL. */
  url: string;
  /**
   * Request headers, for example `Authorization` for a private store. They override the defaults
   * (`Accept: application/json` and the user agent) and never appear in error messages.
   */
  headers?: Record<string, string>;
  /** For the whole request, including reading the body. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Larger responses are rejected. Defaults to 512 KiB. */
  maxBytes?: number;
  /** Defaults to `promptfolio-source-remote`. Some APIs, GitHub's among them, reject requests without one. */
  userAgent?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to the current time. */
  now?: () => Date;
}

export type RemoteProfileErrorKind =
  | "invalid-url"
  | "network"
  | "timeout"
  | "http"
  | "too-large"
  | "not-json";

/**
 * Why a fetch failed. The message names the URL without its query string or credentials, and
 * never contains request headers.
 */
export interface RemoteProfileError {
  kind: RemoteProfileErrorKind;
  /** The response status, for `http` errors. */
  status?: number;
  message: string;
}

export type FetchRemoteProfileResult =
  | {
      ok: true;
      /** Parsed JSON, not validated: pass it to `loadStructuredProfile`. */
      data: unknown;
      /** When the response was read, for the profile's `observedAt`. */
      fetchedAt: Date;
    }
  | { ok: false; error: RemoteProfileError };

/** Fetches and parses a remote profile file, with a timeout and a size limit. */
export async function fetchRemoteProfile(
  options: FetchRemoteProfileOptions,
): Promise<FetchRemoteProfileResult> {
  const timeoutMs = positiveInteger("timeoutMs", options.timeoutMs ?? DEFAULTS.timeoutMs);
  const maxBytes = positiveInteger("maxBytes", options.maxBytes ?? DEFAULTS.maxBytes);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  const url = parseHttpUrl(options.url);
  if (url === undefined) {
    return failure("invalid-url", "The profile URL is not a valid http or https URL");
  }
  const target = `${url.origin}${url.pathname}`;
  const headers = requestHeaders(options);
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    const response = await fetchFn(url, { headers, signal });

    if (!response.ok) {
      const body = await readText(response, ERROR_BODY.maxBytes, { truncate: true });
      const detail = redact(body ?? "", Object.values(options.headers ?? {}))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, ERROR_BODY.maxChars);
      return {
        ok: false,
        error: {
          kind: "http",
          status: response.status,
          message: `${target} answered ${response.status}${detail ? `: ${detail}` : ""}`,
        },
      };
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      return failure("too-large", `${target} sent ${declared} bytes; the limit is ${maxBytes}`);
    }

    const text = await readText(response, maxBytes, { truncate: false });
    if (text === undefined) {
      return failure("too-large", `${target} sent more than ${maxBytes} bytes`);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return failure("not-json", `${target} did not send valid JSON`);
    }
    return { ok: true, data, fetchedAt: now() };
  } catch (error) {
    // The signal covers reading the body too, so a slow body is a timeout as well.
    if (signal.aborted || isAbort(error)) {
      return failure("timeout", `${target} did not answer within ${timeoutMs} ms`);
    }
    return failure("network", `${target} could not be reached`);
  }
}

function failure(kind: RemoteProfileErrorKind, message: string): FetchRemoteProfileResult {
  return { ok: false, error: { kind, message } };
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`fetchRemoteProfile: ${name} must be a positive integer`);
  }
  return value;
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function requestHeaders(options: FetchRemoteProfileOptions): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": options.userAgent ?? DEFAULTS.userAgent,
  });
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
  return headers;
}

/**
 * Reads the body as UTF-8, counting bytes as they arrive, since `Content-Length` can be absent or
 * wrong. Past `maxBytes` it stops reading and returns `undefined`, or with `truncate` what it has.
 */
async function readText(
  response: Response,
  maxBytes: number,
  { truncate }: { truncate: boolean },
): Promise<string | undefined> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      if (!truncate) return undefined;
      chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  // Joined by hand rather than with Node's Buffer, so the package also runs on edge runtimes.
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Some servers echo the request back, so an error body could repeat a token. Removes every
 * header value long enough to be a secret.
 */
function redact(text: string, values: string[]): string {
  let result = text;
  for (const value of values) {
    if (value.length >= MIN_REDACTED_LENGTH) result = result.split(value).join("[redacted]");
    // `Bearer <token>`: the token alone may be echoed too.
    const token = value.split(" ").at(-1);
    if (token && token !== value && token.length >= MIN_REDACTED_LENGTH) {
      result = result.split(token).join("[redacted]");
    }
  }
  return result;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
