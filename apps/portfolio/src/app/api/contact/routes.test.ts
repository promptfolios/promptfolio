import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const loadAppProfile = vi.fn();
vi.mock("@/server/profile", () => ({ loadAppProfile }));

const prepare = await import("./prepare/route");
const send = await import("./send/route");

const SECRET_KEY = "re_test_key";
const PRIVATE_ADDRESS = "owner-private@example.test";

function request(body: unknown) {
  return new Request("http://localhost/api/contact/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DRAFT = { name: "Sam", email: "sam@example.test", message: "Hello there, Jordan." };

function configureContact() {
  vi.stubEnv("RESEND_API_KEY", SECRET_KEY);
  vi.stubEnv("CONTACT_TO_EMAIL", PRIVATE_ADDRESS);
  vi.stubEnv("CONTACT_FROM_EMAIL", "contact@example.test");
  vi.stubEnv("CONTACT_TOKEN_SECRET", "s".repeat(32));
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis_test_token");
}

beforeEach(() => {
  for (const name of [
    "RESEND_API_KEY",
    "CONTACT_TO_EMAIL",
    "CONTACT_FROM_EMAIL",
    "CONTACT_TOKEN_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]) {
    vi.stubEnv(name, "");
  }
  loadAppProfile.mockResolvedValue({
    fileName: "test.json",
    result: { ok: true, profile: { identity: { name: "Jordan Example" } }, warnings: [] },
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ["prepare", prepare.POST, DRAFT],
  ["send", send.POST, { token: "any" }],
])("POST /api/contact/%s: configuration problems", (_name, POST, body) => {
  it("gives 503 and says nothing was sent when the form is off", async () => {
    const response = await POST(request(body));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "failed",
      message: "The contact form is not available right now. Nothing was sent.",
    });
  });

  it("gives 503 when only the Redis settings are present", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis_test_token");

    const response = await POST(request(body));

    expect(response.status).toBe(503);
  });

  it("keeps settings out of the response and the log when the profile cannot be loaded", async () => {
    configureContact();
    loadAppProfile.mockResolvedValue({
      fileName: "test.json",
      result: { ok: false, issues: [{ path: "identity", message: "a private detail" }] },
    });

    const response = await POST(request(body));
    const text = await response.text();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);

    expect(response.status).toBe(503);
    for (const secret of [SECRET_KEY, PRIVATE_ADDRESS, "a private detail"]) {
      expect(text).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
  });
});

describe("POST /api/contact/prepare: a configured form", () => {
  it("returns the review, without the private address", async () => {
    configureContact();

    const response = await prepare.POST(request(DRAFT));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ status: "prepared", recipientName: "Jordan Example" });
    expect(text).not.toContain(PRIVATE_ADDRESS);
  });
});
