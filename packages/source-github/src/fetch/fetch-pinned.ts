import { SELECTION_LIMITS } from "../selection/select";
import { pinnedResponseSchema } from "../snapshot/snapshot";
import type { GitHubClient, OnFetchError } from "./github-client";

/**
 * Full names of pinned public repositories, in pin order (GraphQL, token only): the user's own,
 * and those of other owners, which only rank contributions.
 *
 * GraphQL can answer with partial data: an item the token may not read (for example a
 * repository of an organization that forbids fine-grained tokens) is `null`, with an error
 * whose `path` points at it. Such an item is skipped with a warning. Any other error, or an
 * answer without the user, means the query as a whole was rejected.
 */
export async function fetchPinned(
  client: GitHubClient,
  login: string,
  warnings: string[],
  fail: OnFetchError,
): Promise<{ own: string[]; others: string[] }> {
  const query = `query($login: String!) { user(login: $login) { pinnedItems(first: ${SELECTION_LIMITS.pinned}, types: REPOSITORY) { nodes { ... on Repository { nameWithOwner isFork isPrivate } } } } }`;
  const response = await client.graphql(
    { query, variables: { login } },
    pinnedResponseSchema,
    fail,
  );
  if (response === undefined) return { own: [], others: [] };
  const nodes = response.data?.user?.pinnedItems.nodes;
  const errors = response.errors ?? [];
  const itemErrors = errors.filter((error) => pinnedItemIndex(error.path) !== undefined);
  if (nodes === undefined || itemErrors.length < errors.length) {
    fail({
      kind: "unauthorized",
      target: "graphql",
      message: "GitHub rejected the pinned repositories query; check the token",
    });
    return { own: [], others: [] };
  }
  for (const error of itemErrors) {
    const reason =
      error.type !== undefined && /^[A-Z_]{1,40}$/.test(error.type) ? error.type : "an error";
    warnings.push(
      `Skipped pinned item ${(pinnedItemIndex(error.path) ?? 0) + 1}: GitHub did not return it (${reason})`,
    );
  }

  const owner = `${login.toLowerCase()}/`;
  const own: string[] = [];
  const others: string[] = [];
  for (const node of nodes) {
    if (node === null || node.nameWithOwner === undefined || node.isFork || node.isPrivate)
      continue;
    (node.nameWithOwner.toLowerCase().startsWith(owner) ? own : others).push(node.nameWithOwner);
  }
  return { own, others };
}

/** The item index of an error path `user.pinnedItems.nodes.<index>`, or undefined. */
function pinnedItemIndex(path: Array<string | number> | undefined): number | undefined {
  if (path === undefined || path.length !== 4) return undefined;
  const [user, items, nodes, index] = path;
  return user === "user" &&
    items === "pinnedItems" &&
    nodes === "nodes" &&
    typeof index === "number"
    ? index
    : undefined;
}
