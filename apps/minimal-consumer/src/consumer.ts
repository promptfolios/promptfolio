import { type ChatTurnLimiter, handleChatRequest } from "@promptfolio/ai";
import {
  type ContactOptions,
  type ContactSender,
  handleContactPrepare,
  handleContactSend,
} from "@promptfolio/contact";
import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import {
  carryForward,
  fetchGitHubSnapshot,
  type GitHubSnapshot,
  type GitHubSourceConfig,
  mergeGitHubSnapshot,
  parseGitHubConfig,
} from "@promptfolio/source-github";
import type { LanguageModel } from "ai";
import githubConfig from "./data/github-config.json";
import ownerProfile from "./data/profile.json";

/*
 * Everything a consumer has to write to use the packages, with no framework: its own data, a
 * model, a store for the limits, and a way to tell visitors apart. It imports only the packages'
 * public entry points. Its tests are what this file is for: it has no server of its own.
 */

export function loadGitHubConfig(): GitHubSourceConfig {
  const parsed = parseGitHubConfig(githubConfig);
  if (!parsed.ok) throw new Error(`invalid GitHub config: ${JSON.stringify(parsed.issues)}`);
  return parsed.config;
}

export function loadProfile(snapshot: unknown): Profile {
  const owner = loadStructuredProfile(ownerProfile, {
    sourceId: "owner-profile",
    label: "Owner-provided profile",
    observedAt: new Date("2026-10-30T06:00:00.000Z"),
  });
  if (!owner.ok) throw new Error(`invalid profile: ${JSON.stringify(owner.issues)}`);
  const merged = mergeGitHubSnapshot(owner.profile, loadGitHubConfig(), snapshot);
  if (!merged.ok) throw new Error(`invalid snapshot: ${JSON.stringify(merged.issues)}`);
  return merged.profile;
}

/** The whole refresh a consumer needs: fetch, keep what could not be read, and check the result. */
export async function refreshSnapshot(
  previous: GitHubSnapshot | undefined,
  fetchFn: typeof fetch,
): Promise<GitHubSnapshot | undefined> {
  const config = loadGitHubConfig();
  const fetched = await fetchGitHubSnapshot(config, { fetch: fetchFn });
  const carried = carryForward(previous, fetched);
  if (carried.status === "failed") return previous;
  loadProfile(carried.snapshot);
  return carried.snapshot;
}

/** A limiter in memory. A real deployment needs a store shared between requests. */
export function memoryLimiter(allowance: number): ChatTurnLimiter {
  const counts = new Map<string, number>();
  return {
    take: async (visitor) => {
      const count = (counts.get(visitor) ?? 0) + 1;
      counts.set(visitor, count);
      return count > allowance ? "visitor-limit" : "allowed";
    },
  };
}

export interface ConsumerOptions {
  model: LanguageModel;
  profile: Profile;
  limiter: ChatTurnLimiter;
  contact: Pick<ContactOptions, "limiter" | "tokenSecret"> & { sender: ContactSender };
}

/** Three web handlers, which any server that speaks `Request` and `Response` can mount. */
export function createConsumer({ model, profile, limiter, contact }: ConsumerOptions) {
  const identifyVisitor = async (request: Request) => request.headers.get("x-visitor") ?? undefined;
  const contactOptions: ContactOptions = {
    ...contact,
    recipient: { name: profile.identity.name, address: "avery@example.test" },
    from: "Avery's site <site@example.test>",
    identifyVisitor,
  };
  return {
    chat: (request: Request) =>
      handleChatRequest(request, {
        model,
        profile,
        contactFormAvailable: true,
        limit: { limiter, identifyVisitor },
      }),
    prepareContact: (request: Request) => handleContactPrepare(request, contactOptions),
    sendContact: (request: Request) => handleContactSend(request, contactOptions),
  };
}
