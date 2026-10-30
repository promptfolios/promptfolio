import type { ComponentProps, FC } from "react";

import { safeHref } from "@/components/assistant-ui/utils/href";

/**
 * A Markdown image in model text, shown as a link and never loaded. Model text can repeat
 * instructions from untrusted sources, and a browser fetches an image without being asked, so an
 * injected image URL holding conversation text would otherwise leak it. A link needs a click. The
 * `img-src` policy in `next.config.ts` is a second layer.
 */
export const MarkdownImage: FC<ComponentProps<"img">> = ({ src, alt }) => {
  const label = alt?.trim() || "Image link";
  const href = typeof src === "string" ? safeHref(src) : undefined;
  if (href === undefined) return <span>{label}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="aui-md-a text-primary hover:text-primary/80 underline underline-offset-2"
    >
      {label}
    </a>
  );
};
