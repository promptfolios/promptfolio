import { describe, expect, it } from "vitest";
import { type FetchRemoteProfileOptions, fetchRemoteProfile } from "./fetch-remote-profile.ts";

const URL_ = "https://example.com/profile.json";
const FETCHED_AT = new Date("2026-11-11T12:00:00.000Z");
const TOKEN = "github_pat_example_secret_value";

type FakeFetch = (input: URL, init: RequestInit) => Promise<Response>;

/** Calls `fetchRemoteProfile` with a fake `fetch` and a fixed clock. */
function fetchWith(fake: FakeFetch, options: Partial<FetchRemoteProfileOptions> = {}) {
  return fetchRemoteProfile({
    url: URL_,
    fetch: fake as unknown as typeof fetch,
    now: () => FETCHED_AT,
    ...options,
  });
}

/** A body sent in chunks, with no `Content-Length`, as a server streaming its response would. */
function streamed(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("fetchRemoteProfile: success", () => {
  it("returns the parsed JSON and when it was read", async () => {
    const result = await fetchWith(async () => Response.json({ schemaVersion: 1 }));

    expect(result).toEqual({ ok: true, data: { schemaVersion: 1 }, fetchedAt: FETCHED_AT });
  });

  it("sends the default Accept and User-Agent, and lets the caller's headers override them", async () => {
    const seen: Headers[] = [];
    const fake: FakeFetch = async (_input, init) => {
      seen.push(new Headers(init.headers));
      return Response.json({});
    };

    await fetchWith(fake);
    await fetchWith(fake, {
      userAgent: "my-site",
      headers: { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${TOKEN}` },
    });

    expect(seen[0]?.get("accept")).toBe("application/json");
    expect(seen[0]?.get("user-agent")).toBe("promptfolio-source-remote");
    expect(seen[1]?.get("accept")).toBe("application/vnd.github.raw+json");
    expect(seen[1]?.get("user-agent")).toBe("my-site");
    expect(seen[1]?.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("reads a streamed body without Content-Length", async () => {
    const result = await fetchWith(async () => new Response(streamed(['{"a":', "1}"])));

    expect(result).toMatchObject({ ok: true, data: { a: 1 } });
  });
});

describe("fetchRemoteProfile: failures", () => {
  it("rejects a URL that is not http or https without fetching", async () => {
    let calls = 0;
    const fake: FakeFetch = async () => {
      calls += 1;
      return Response.json({});
    };

    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
      expect(await fetchWith(fake, { url })).toEqual({
        ok: false,
        error: { kind: "invalid-url", message: "The profile URL is not a valid http or https URL" },
      });
    }
    expect(calls).toBe(0);
  });

  it("reports an error status with the start of the response body", async () => {
    const result = await fetchWith(async () =>
      Response.json({ message: "Bad credentials" }, { status: 401 }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "http",
        status: 401,
        message: 'https://example.com/profile.json answered 401: {"message":"Bad credentials"}',
      },
    });
  });

  it("keeps request headers out of messages, even when the server echoes them", async () => {
    const result = await fetchWith(
      async (_input, init) => {
        const auth = new Headers(init.headers).get("authorization") ?? "";
        return new Response(`you sent ${auth} and token ${TOKEN}`, { status: 400 });
      },
      { url: `${URL_}?access_token=query-secret`, headers: { Authorization: `Bearer ${TOKEN}` } },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain(TOKEN);
    expect(result.error.message).not.toContain("query-secret");
    expect(result.error.message).toContain("[redacted]");
  });

  it("rejects a declared Content-Length over the limit before reading the body", async () => {
    let pulled = false;
    // highWaterMark 0: the stream pulls only when something reads it, not once on creation.
    const body = new ReadableStream(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const result = await fetchWith(
      async () => new Response(body, { headers: { "Content-Length": "2048" } }),
      { maxBytes: 1024 },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "too-large",
        message: "https://example.com/profile.json sent 2048 bytes; the limit is 1024",
      },
    });
    expect(pulled).toBe(false);
  });

  it("stops reading a streamed body once it passes the limit", async () => {
    const result = await fetchWith(
      async () => new Response(streamed(["x".repeat(600), "y".repeat(600)])),
      { maxBytes: 1024 },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "too-large",
        message: "https://example.com/profile.json sent more than 1024 bytes",
      },
    });
  });

  it("reports a body that is not JSON", async () => {
    const result = await fetchWith(async () => new Response("<html>Not found</html>"));

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "not-json",
        message: "https://example.com/profile.json did not send valid JSON",
      },
    });
  });

  it("reports a server that does not answer in time", async () => {
    const fake: FakeFetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });

    expect(await fetchWith(fake, { timeoutMs: 20 })).toEqual({
      ok: false,
      error: {
        kind: "timeout",
        message: "https://example.com/profile.json did not answer within 20 ms",
      },
    });
  });

  it("reports a body that stops arriving as a timeout", async () => {
    const fake: FakeFetch = async (_input, init) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":'));
          init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return new Response(body);
    };

    expect(await fetchWith(fake, { timeoutMs: 20 })).toMatchObject({
      ok: false,
      error: { kind: "timeout" },
    });
  });

  it("reports a failed connection as a network error", async () => {
    const result = await fetchWith(async () => {
      throw new TypeError("fetch failed");
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "network", message: "https://example.com/profile.json could not be reached" },
    });
  });

  it("throws for invalid options, which are a programming error", async () => {
    await expect(fetchWith(async () => Response.json({}), { timeoutMs: 0 })).rejects.toThrow(
      "timeoutMs must be a positive integer",
    );
    await expect(fetchWith(async () => Response.json({}), { maxBytes: 1.5 })).rejects.toThrow(
      "maxBytes must be a positive integer",
    );
  });
});
