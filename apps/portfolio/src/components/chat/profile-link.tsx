"use client";

import {
  type ComponentProps,
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useMemo,
} from "react";

const ProfileLinksContext = createContext<ReadonlySet<string>>(new Set());

/** Provides the profile's URLs, in the form `profileLinkUrls` returns them, to the answers below. */
export const ProfileLinksProvider: FC<{ urls: readonly string[]; children: ReactNode }> = ({
  urls,
  children,
}) => {
  const allowed = useMemo(() => new Set(urls), [urls]);
  return <ProfileLinksContext.Provider value={allowed}>{children}</ProfileLinksContext.Provider>;
};

function isProfileLink(href: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (href === undefined) return false;
  try {
    return allowed.has(new URL(href).href);
  } catch {
    return false;
  }
}

/**
 * A link in an answer. Model output is untrusted: text in a public source could get the model to
 * write a link that sends the conversation to another site. So only an exact URL from the profile
 * becomes a link, and anything else stays as its plain text. This checks the links as rendered, so
 * it covers every way Markdown can write one, and saved threads too.
 */
export const ProfileLink: FC<ComponentProps<"a">> = ({ href, children, ...props }) => {
  const allowed = useContext(ProfileLinksContext);
  if (!isProfileLink(href, allowed)) return <>{children}</>;
  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
};
