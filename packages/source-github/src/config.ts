import type { ProfileIssue } from "@promptfolio/core";
import { z } from "zod";
import { issuesFrom } from "./issues";

/**
 * The owner's GitHub configuration: the username, once, and optionally repositories to hide.
 * Which repositories are included is decided automatically (see `selectRepositories`).
 */
export interface GitHubSourceConfig {
  user: string;
  /** Repository names (without owner) never included, compared case-insensitively. */
  exclude: string[];
  /** Repositories (`owner/name`) whose commits are never contributions, case-insensitively. */
  excludeContributionsTo: string[];
}

export type ParseGitHubConfigResult =
  | { ok: true; config: GitHubSourceConfig }
  | { ok: false; issues: ProfileIssue[] };

export const CONFIG_LIMITS = { maxExcluded: 50 } as const;

/** GitHub usernames: letters, digits, single inner hyphens, at most 39 characters. */
export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, "Expected a GitHub username");

/** GitHub repository names: letters, digits, `.`, `_`, `-`, at most 100 characters. */
export const repositoryNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/, "Expected a GitHub repository name");

const fullNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, "Expected a repository as owner/name");

const configSchema = z.strictObject({
  formatVersion: z.literal(1),
  user: usernameSchema,
  exclude: z.array(repositoryNameSchema).max(CONFIG_LIMITS.maxExcluded).default([]),
  excludeContributionsTo: z.array(fullNameSchema).max(CONFIG_LIMITS.maxExcluded).default([]),
});

/** Validates untrusted configuration data, typically parsed JSON from the owner's file. */
export function parseGitHubConfig(data: unknown): ParseGitHubConfigResult {
  const parsed = configSchema.safeParse(data);
  if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };
  const { user, exclude, excludeContributionsTo } = parsed.data;
  return { ok: true, config: { user, exclude, excludeContributionsTo } };
}

/** Whether commits in a repository (`owner/name`) are hidden from the contributions. */
export function isContributionExcluded(config: GitHubSourceConfig, fullName: string): boolean {
  const key = fullName.toLowerCase();
  return config.excludeContributionsTo.some((excluded) => excluded.toLowerCase() === key);
}

/** Whether a repository name is in the exclusion list. */
export function isExcluded(config: GitHubSourceConfig, name: string): boolean {
  const key = name.toLowerCase();
  return config.exclude.some((excluded) => excluded.toLowerCase() === key);
}
