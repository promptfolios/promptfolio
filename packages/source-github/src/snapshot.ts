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
  maxContributions: 50,
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
            // A node is null when GitHub could not return that item (see `errors`), for
            // example a repository of an organization that forbids the token.
            nodes: z.array(
              z
                .object({
                  nameWithOwner: z.string().optional(),
                  isFork: z.boolean().optional(),
                  isPrivate: z.boolean().optional(),
                })
                .nullable(),
            ),
          }),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  // GraphQL errors can come with partial data. Only `path` and `type` are read, never `message`.
  errors: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])).optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
});

const commitSearchItemSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  html_url: z.url({ protocol: /^https$/ }),
  // Only the date: the commit's author name and email are never read.
  commit: z.object({ message: z.string(), author: z.object({ date: isoDateTime }) }),
  /** The account GitHub links the commit to, by its email; null when there is none. */
  author: z.object({ login: z.string() }).nullable(),
  parents: z.array(z.unknown()),
  repository: z.object({
    full_name: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]{1,100}$/),
    html_url: z.url({ protocol: /^https$/ }),
    description: z.string().max(SNAPSHOT_LIMITS.maxDescriptionChars).nullable(),
    private: z.boolean(),
    fork: z.boolean(),
    owner: z.object({ login: z.string() }),
  }),
});

/** One result of `GET /search/commits`, the fields the adapter uses. */
export type CommitSearchItem = z.infer<typeof commitSearchItemSchema>;

export const commitSearchResponseSchema = z.object({
  incomplete_results: z.boolean(),
  items: z.array(commitSearchItemSchema).max(100),
});

/** Stars of a repository: only to choose between copies of a commit, and never stored. */
export const repositoryStarsSchema = z.object({ stargazers_count: z.number().int().nonnegative() });

// --- Snapshot file ----------------------------------------------------------------------

const snapshotRepositoryFields = {
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
};

const snapshotFields = {
  retrievedAt: isoDateTime,
  /** Whether a token was used, which decides pinned repositories and the repository cap. */
  authenticated: z.boolean(),
  user: z.strictObject({ login: usernameSchema, htmlUrl: z.url({ protocol: /^https$/ }) }),
};

/** Version 1 (M8): one `retrievedAt` for the whole file. Still read, never written. */
const snapshotV1Schema = z.strictObject({
  formatVersion: z.literal(1),
  ...snapshotFields,
  repositories: z
    .array(z.strictObject(snapshotRepositoryFields))
    .max(SNAPSHOT_LIMITS.maxRepositories),
});

const snapshotRepositorySchema = z.strictObject({
  /**
   * When this repository's data was read. Earlier than the file's `retrievedAt` when a
   * refresh could not read it again and kept the previous data (last known good).
   */
  retrievedAt: isoDateTime,
  ...snapshotRepositoryFields,
});

const snapshotContributionSchema = z.strictObject({
  /** When this entry was read; earlier than the file's when a refresh kept earlier data. */
  retrievedAt: isoDateTime,
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  /** The first line of the commit message, written on GitHub. */
  title: z.string().max(SNAPSHOT_LIMITS.maxDescriptionChars),
  htmlUrl: z.url({ protocol: /^https$/ }),
  repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]{1,100}$/),
  repositoryUrl: z.url({ protocol: /^https$/ }),
  repositoryDescription: z.string().max(SNAPSHOT_LIMITS.maxDescriptionChars).nullable(),
  authoredAt: isoDateTime,
});

/** Version 2 (M9): every repository has its own `retrievedAt`. Contributions (M8.1) are added. */
const snapshotV2Schema = z
  .strictObject({
    formatVersion: z.literal(2),
    /** When the run that wrote this file read GitHub. */
    ...snapshotFields,
    repositories: z.array(snapshotRepositorySchema).max(SNAPSHOT_LIMITS.maxRepositories),
    /** Older files have none yet. */
    contributions: z
      .array(snapshotContributionSchema)
      .max(SNAPSHOT_LIMITS.maxContributions)
      .default([]),
  })
  .superRefine((snapshot, context) => {
    const written = Date.parse(snapshot.retrievedAt);
    const checkTimes = (section: string, entries: Array<{ retrievedAt: string }>) => {
      entries.forEach((entry, index) => {
        if (Date.parse(entry.retrievedAt) > written) {
          context.addIssue({
            code: "custom",
            path: [section, index, "retrievedAt"],
            message: "Later than the snapshot's retrievedAt",
          });
        }
      });
    };
    checkTimes("repositories", snapshot.repositories);
    checkTimes("contributions", snapshot.contributions);
  });

const snapshotSchema = z.discriminatedUnion("formatVersion", [snapshotV1Schema, snapshotV2Schema]);

/**
 * What GitHub showed, as validated by the fetcher: the time of the run that wrote it, and
 * per repository the time its data was read. Always version 2 in memory.
 */
export type GitHubSnapshot = z.infer<typeof snapshotV2Schema>;
export type SnapshotRepository = z.infer<typeof snapshotRepositorySchema>;
export type SnapshotContribution = z.infer<typeof snapshotContributionSchema>;

export type ParseGitHubSnapshotResult =
  | { ok: true; snapshot: GitHubSnapshot }
  | { ok: false; issues: ProfileIssue[] };

/**
 * Validates a snapshot read back from a file. The file is untrusted input like any other:
 * it may have been edited by hand or written by an older version. A version 1 file is
 * upgraded: each repository takes the file's `retrievedAt`.
 */
export function parseGitHubSnapshot(data: unknown): ParseGitHubSnapshotResult {
  const parsed = snapshotSchema.safeParse(data);
  if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };
  const snapshot = parsed.data;
  if (snapshot.formatVersion === 2) return { ok: true, snapshot };
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      formatVersion: 2,
      repositories: snapshot.repositories.map((repository) => ({
        retrievedAt: snapshot.retrievedAt,
        ...repository,
      })),
      contributions: [],
    },
  };
}
