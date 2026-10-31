import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const { createVisitorIdentifier, visitorNetwork } = await import("./visitor");

describe("visitorNetwork", () => {
  it.each([
    ["an IPv4 address", "203.0.113.7", "203.0.113.7"],
    ["an IPv4 address in IPv6 form", "::ffff:203.0.113.7", "203.0.113.7"],
    ["surrounding spaces", " 203.0.113.7 ", "203.0.113.7"],
    ["a full IPv6 address", "2001:0db8:0001:0002:0003:0004:0005:0006", "2001:db8:1:2"],
    ["a shortened IPv6 address", "2001:db8::1", "2001:db8:0:0"],
    ["an IPv6 address shortened early", "::1", "0:0:0:0"],
    ["a dotted IPv6 tail", "2001:db8::203.0.113.7", "2001:db8:0:0"],
    ["upper case", "2001:DB8:A::1", "2001:db8:a:0"],
    ["a zone", "fe80::1%eth0", "fe80:0:0:0"],
  ])("handles %s", (_label, address, network) => {
    expect(visitorNetwork(address)).toBe(network);
  });

  it("gives every address in one IPv6 /64 the same network, and another /64 a different one", () => {
    const network = visitorNetwork("2001:db8:1:2::a");
    expect(visitorNetwork("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(network);
    expect(visitorNetwork("2001:db8:1:3::a")).not.toBe(network);
  });

  it.each(["", "unknown", "not an address", "999.1.1.1", "203.0.113.7:443", "1:2:3"])(
    "refuses %j",
    (address) => {
      expect(visitorNetwork(address)).toBeUndefined();
    },
  );
});

describe("createVisitorIdentifier", () => {
  const SECRET = "s".repeat(32);
  const identify = createVisitorIdentifier(SECRET, "test-visitor");

  function requestFrom(headers: Record<string, string>) {
    return new Request("http://localhost/api/contact/send", { method: "POST", headers });
  }

  it("never returns the address, and is stable for one address", async () => {
    const first = await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" }));

    expect(first).toBeTruthy();
    expect(first).not.toContain("203.0.113.7");
    expect(await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" }))).toBe(first);
  });

  it("gives different addresses and different secrets different results", async () => {
    const request = () => requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" });
    const first = await identify(request());

    expect(await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.8" }))).not.toBe(
      first,
    );
    expect(await createVisitorIdentifier("t".repeat(32), "test-visitor")(request())).not.toBe(
      first,
    );
  });

  it("prefers Vercel's header, and uses the first address in a list", async () => {
    const expected = await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" }));

    expect(
      await identify(
        requestFrom({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }),
      ),
    ).toBe(expected);
    expect(await identify(requestFrom({ "x-forwarded-for": "203.0.113.7, 198.51.100.1" }))).toBe(
      expected,
    );
  });

  it("returns nothing when no usable address is shown", async () => {
    expect(await identify(requestFrom({}))).toBeUndefined();
    expect(await identify(requestFrom({ "x-forwarded-for": "unknown" }))).toBeUndefined();
  });

  it("gives different labels different results, so one use's hash cannot be matched to another's", async () => {
    const request = () => requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" });

    expect(await createVisitorIdentifier(SECRET, "other-visitor")(request())).not.toBe(
      await identify(request()),
    );
  });
});
