import { chatSourcesSchema } from "./sources";

/**
 * Citations in the answer's Markdown become small numbered markers that point at the sources panel.
 * A remark plugin finds them, so code and real links are left alone, and turns each into a link with
 * a recognisable `href`, which the Markdown link component then draws as a marker.
 */

const CITATION_HREF_PREFIX = "#citation-";

function citationHref(id: string): string {
  return `${CITATION_HREF_PREFIX}${encodeURIComponent(id)}`;
}

/** The cited id if this link is a citation marker, or `undefined` for any other link. */
export function citationIdFromHref(href: string | undefined): string | undefined {
  if (!href?.startsWith(CITATION_HREF_PREFIX)) return undefined;
  try {
    return decodeURIComponent(href.slice(CITATION_HREF_PREFIX.length));
  } catch {
    return undefined;
  }
}

/**
 * The ids in one `[...]`. Keeps the server's reading of a citation, including a drifted `[a, b]` or
 * `[a; b]`, look-alike hyphens, and leaving out text with a space, which no id has.
 */
function idsIn(bracketContent: string): string[] {
  return bracketContent
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .split(/[,;]/)
    .map((id) => id.trim())
    .filter((id) => id !== "" && !/\s/.test(id));
}

/** The parts of a Markdown syntax tree node this plugin reads or writes. */
export interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

/** The nodes that replace one text node, with citations as links. */
function splitCitations(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let position = 0;
  for (const match of value.matchAll(/\[([^[\]]+)\]/g)) {
    const ids = idsIn(match[1] ?? "");
    if (ids.length === 0) continue;
    // The space before a citation would otherwise show up before the small marker.
    const before = value.slice(position, match.index).trimEnd();
    if (before !== "") nodes.push({ type: "text", value: before });
    for (const id of ids) {
      nodes.push({
        type: "link",
        url: citationHref(id),
        children: [{ type: "text", value: `[${id}]` }],
      });
    }
    position = match.index + match[0].length;
  }
  const after = value.slice(position);
  if (after !== "") nodes.push({ type: "text", value: after });
  return nodes;
}

function replaceCitations(node: MarkdownNode): void {
  // A link's text is already a link, and code has no text children to change.
  if (node.children === undefined || node.type === "link" || node.type === "linkReference") return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value !== undefined) return splitCitations(child.value);
    replaceCitations(child);
    return [child];
  });
}

/** A remark plugin: turns `[id]` in ordinary text into a citation link. */
export function remarkCitations() {
  return replaceCitations;
}

export type CitationDisplay =
  /**
   * Nothing to draw: the answer is still streaming, so the sources that number the markers have not
   * arrived, or the server could not match this citation, so there is no source to lead to.
   */
  | { kind: "hidden" }
  /** The answer has no sources, as in a thread saved earlier or a reply that failed: keep the text. */
  | { kind: "raw" }
  | { kind: "source"; number: number; record: string };

/** How to draw one citation, given the message's sources (unchecked) and whether it is running. */
export function citationDisplay(id: string, data: unknown, running: boolean): CitationDisplay {
  const parsed = chatSourcesSchema.safeParse(data);
  if (!parsed.success) return running ? { kind: "hidden" } : { kind: "raw" };
  const index = parsed.data.sources.findIndex((source) => source.id === id);
  const source = parsed.data.sources[index];
  return source === undefined
    ? { kind: "hidden" }
    : { kind: "source", number: index + 1, record: source.record };
}
