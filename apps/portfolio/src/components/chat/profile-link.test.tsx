import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileLink, ProfileLinksProvider } from "./profile-link";

const PROFILE_URL = "https://github.com/jordan/linter";

function render(href: string | undefined, urls: string[] = [PROFILE_URL]) {
  return renderToStaticMarkup(
    <ProfileLinksProvider urls={urls}>
      <ProfileLink href={href} className="link">
        linter
      </ProfileLink>
    </ProfileLinksProvider>,
  );
}

describe("ProfileLink", () => {
  it("links a URL from the profile, opening it safely in a new tab", () => {
    const html = render(PROFILE_URL);

    expect(html).toContain(`href="${PROFILE_URL}"`);
    expect(html).toContain('class="link"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it.each([
    ["another site", "https://attacker.example/?q=my+conversation"],
    ["a longer URL on an allowed site", `${PROFILE_URL}/issues?q=my+conversation`],
    ["a script", "javascript:alert(1)"],
    ["a relative address", "/somewhere"],
    ["no address", undefined],
  ])("shows %s as plain text", (_name, href) => {
    expect(render(href)).toBe("linter");
  });

  it("matches a URL however the renderer normalized it", () => {
    const withSpace = "https://example.test/a%20b";

    expect(render("https://EXAMPLE.test/a%20b", [withSpace])).toContain("<a ");
  });

  it("links nothing when the profile has no URLs", () => {
    expect(render(PROFILE_URL, [])).toBe("linter");
  });
});
