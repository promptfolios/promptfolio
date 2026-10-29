import type { ProfileIssue } from "@promptfolio/core";
import { z } from "zod";
import { repositoryNameSchema, usernameSchema } from "./config";
import { issuesFrom } from "./issues";

/*
 * Two kinds of schemas live here:
 *
 * - GitHub response schemas: the subset of GitHub's REST and GraphQL responses that the
 *   adapter uses (REST API version 2026-03-10). They are not strict, because GitHub adds
 *   fields over time; unknown fields are dropped.
 * - The snapshot file schema: Promptfolio's own format, strict, read back on every request.
 */

export const SNAPSHOT_LIMITS = {
  maxRepositories: 30,
  /** Raw README characters kept in the snapshot; the profile keeps a shorter excerpt. */
  maxReadmeChars: 20_000,
  maxDescriptionChars: 10_000,
  maxTopics: 100,
  maxLanguages: 200,
} as const;

const isoDateTime = z.iso.datetime({ offset: true });

// --- GitHub responses -------------------------------------------------------------------

export const userResponseSchema = z.object({
  login: usernameSchema,
  html_url: z.url({ protocol: /^https$/ }),
  type: z.string(),
});

export const listedRepositorySchema = z.object({
  name: repositoryNameSchema,
  full_name: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]{1,100}$/),
  html_url: z.url({ protocol: /^https$/ }),
  description: z.string().max(SNAPSHOT_LIMITS.maxDescriptionChars).nullable(),
  homepage: z.string().max(2048).nullable().optional(),
  language: z.string().max(200).nullable(),
  topics: z.array(z.string().max(200)).max(SNAPSHOT_LIMITS.maxTopics).optional(),
  fork: z.boolean(),
  archived: z.boolean(),
  private: z.boolean(),
  visibility: z.string().optional(),
  created_at: isoDateTime.nullable().optional(),
  pushed_at: isoDateTime.nullable().optional(),
  license: z
    .object({ spdx_id: z.string().max(200).nullable() })
    .nullable()
    .optional(),
});

/** A repository as it appears in `GET /users/{username}/repos` or `GET /repos/{owner}/{repo}`. */
export type ListedRepository = z.infer<typeof listedRepositorySchema>;

export const repositoryListSchema = z.array(listedRepositorySchema).max(100);

/** `GET /repos/{owner}/{repo}/languages`: bytes of code per language. */
export const languagesResponseSchema = z
  .record(z.string().max(200), z.number().int().nonnegative())
  .refine(
    (value) => Object.keys(value).length <= SNAPSHOT_LIMITS.maxLanguages,
    "Too many languages",
  );

export const pinnedResponseSchema = z.object({
  data: z
    .object({
      user: z
        .object({
          pinnedItems: z.object({
            nodes: z.array(
              z.object({
                nameWithOwner: z.string().optional(),
                isFork: z.boolean().optional(),
                isPrivate: z.boolean().optional(),
              }),
            ),
          }),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.unknown()).optional(),
});

// --- Snapshot file ----------------------------------------------------------------------

const snapshotRepositorySchema = z.strictObject({
  name: repositoryNameSchema,
  fullName: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]{1,100}$/),
  htmlUrl: z.url({ protocol: /^https$/ }),
  description: z.string().max(SNAPSHOT_LIMITS.maxDescriptionChars).nullable(),
  homepage: z.string().max(2048).nullable(),
  language: z.string().max(200).nullable(),
  /** Bytes of code per language, as GitHub reports them. */
  languages: z.record(z.string().max(200), z.number().int().nonnegative()),
  topics: z.array(z.string().max(200)).max(SNAPSHOT_LIMITS.maxTopics),
  fork: z.boolean(),
  archived: z.boolean(),
  createdAt: isoDateTime.nullable(),
  pushedAt: isoDateTime.nullable(),
  license: z.string().max(200).nullable(),
  pinned: z.boolean(),
  /** Raw README text, cut at `maxReadmeChars`; null when the repository has none. */
  readme: z.string().max(SNAPSHOT_LIMITS.maxReadmeChars).nullable(),
  readmeTruncated: z.boolean(),
});

const snapshotSchema = z.strictObject({
  formatVersion: z.literal(1),
  retrievedAt: isoDateTime,
  /** Whether a token was used, which decides pinned repositories and the repository cap. */
  authenticated: z.boolean(),
  user: z.strictObject({ login: usernameSchema, htmlUrl: z.url({ protocol: /^https$/ }) }),
  repositories: z.array(snapshotRepositorySchema).max(SNAPSHOT_LIMITS.maxRepositories),
});

/** What one fetch observed on GitHub: the validated subset, with the time it was retrieved. */
export type GitHubSnapshot = z.infer<typeof snapshotSchema>;
export type SnapshotRepository = z.infer<typeof snapshotRepositorySchema>;

export type ParseGitHubSnapshotResult =
  | { ok: true; snapshot: GitHubSnapshot }
  | { ok: false; issues: ProfileIssue[] };

/**
 * Validates a snapshot read back from a file. The file is untrusted input like any other:
 * it may have been edited by hand or written by an older version.
 */
export function parseGitHubSnapshot(data: unknown): ParseGitHubSnapshotResult {
  const parsed = snapshotSchema.safeParse(data);
  if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };
  return { ok: true, snapshot: parsed.data };
}
