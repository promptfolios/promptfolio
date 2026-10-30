import type {
  ContributionInput,
  ExternalLink,
  LanguageShare,
  ObservedRecords,
  PartialDate,
  ProfileIssue,
  RepositoryInput,
} from "@promptfolio/core";
import { type GitHubSourceConfig, isContributionExcluded, isExcluded } from "./config";
import type { GitHubSnapshot, SnapshotContribution, SnapshotRepository } from "./snapshot";

export const NORMALIZE_LIMITS = {
  descriptionChars: 500,
  titleChars: 200,
  readmeChars: 3000,
  /** A README is cut at a line break only if one exists in the last part of the excerpt. */
  readmeMinCutChars: 1500,
  languages: 5,
  topics: 20,
} as const;

/** The source id that GitHub records carry; `Profile.sources` gets one entry with it. */
export const GITHUB_SOURCE_ID = "github";

export type NormalizeGitHubResult =
  | { ok: true; records: ObservedRecords; warnings: ProfileIssue[] }
  | { ok: false; issues: ProfileIssue[] };

/**
 * Turns a snapshot into source-neutral records for `addObservedRecords`. Pure: no I/O.
 *
 * The configuration is applied again here, so an exclusion takes effect without refetching.
 * A snapshot taken for a different user than the configured one is rejected.
 */
export function normalizeGitHubSnapshot(
  snapshot: GitHubSnapshot,
  config: GitHubSourceConfig,
): NormalizeGitHubResult {
  if (snapshot.user.login.toLowerCase() !== config.user.toLowerCase()) {
    return {
      ok: false,
      issues: [
        {
          path: "user.login",
          message: `The snapshot is for @${snapshot.user.login}, but the configuration names @${config.user}; run refresh`,
        },
      ],
    };
  }

  const warnings: ProfileIssue[] = [];
  const repositories = snapshot.repositories
    .filter((repository) => !isExcluded(config, repository.name))
    .map((repository, index) => {
      const record = toRepository(repository, (message) =>
        warnings.push({
          path: `repositories[${index}]`,
          message: `${repository.fullName}: ${message}`,
        }),
      );
      // A repository kept from an earlier run (last known good) says when it was read.
      return repository.retrievedAt === snapshot.retrievedAt
        ? record
        : { ...record, observedAt: new Date(repository.retrievedAt) };
    });
  const contributions = snapshot.contributions
    .filter((contribution) => !isContributionExcluded(config, contribution.repository))
    .flatMap((contribution, index) => {
      const warn = (message: string) =>
        warnings.push({
          path: `contributions[${index}]`,
          message: `${contribution.repository}: ${message}`,
        });
      const record = toContribution(contribution, warn);
      if (record === undefined) return [];
      return contribution.retrievedAt === snapshot.retrievedAt
        ? [record]
        : [{ ...record, observedAt: new Date(contribution.retrievedAt) }];
    });
  const links: ExternalLink[] = [{ label: "GitHub", url: snapshot.user.htmlUrl }];

  return {
    ok: true,
    records: {
      source: {
        id: GITHUB_SOURCE_ID,
        kind: "github",
        label: `Public GitHub data for @${snapshot.user.login}`,
        url: snapshot.user.htmlUrl,
        retrievedAt: new Date(snapshot.retrievedAt),
      },
      links,
      repositories,
      contributions,
    },
    warnings,
  };
}

/** `github.com/<owner>/<repo>`, lowercased: GitHub treats both names case-insensitively. */
export function repositoryKey(fullName: string): string {
  return `github.com/${fullName.toLowerCase()}`;
}

function toRepository(
  repository: SnapshotRepository,
  warn: (message: string) => void,
): RepositoryInput {
  const description = cleanDescription(repository.description, warn);
  const homepage = cleanHomepage(repository.homepage, warn);
  const created = monthOf(repository.createdAt);
  const lastActivity = monthOf(repository.pushedAt);
  const license =
    repository.license !== null && repository.license !== "NOASSERTION"
      ? repository.license
      : undefined;
  const readme = readmeExcerpt(repository.readme, repository.readmeTruncated);

  return {
    id: repositoryKey(repository.fullName),
    name: repository.name,
    fullName: repository.fullName,
    url: repository.htmlUrl,
    languages: languageShares(repository.languages),
    topics: repository.topics
      .filter((topic) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(topic))
      .slice(0, NORMALIZE_LIMITS.topics),
    fork: repository.fork,
    archived: repository.archived,
    ...(description !== undefined && { description }),
    ...(homepage !== undefined && { homepage }),
    ...(created !== undefined && { created }),
    ...(lastActivity !== undefined && { lastActivity }),
    ...(license !== undefined && { license }),
    ...(readme !== undefined && { readme: readme.text, readmeTruncated: readme.truncated }),
  };
}

function toContribution(
  contribution: SnapshotContribution,
  warn: (message: string) => void,
): ContributionInput | undefined {
  const title = cleanTitle(contribution.title, warn);
  const authored = monthOf(contribution.authoredAt);
  if (title === undefined || authored === undefined) {
    warn(`commit ${contribution.sha} dropped: no title or date`);
    return undefined;
  }
  const repositoryDescription = cleanDescription(contribution.repositoryDescription, warn);
  const repositoryId = repositoryKey(contribution.repository);
  return {
    id: `${repositoryId}/commit/${contribution.sha}`,
    title,
    url: contribution.htmlUrl,
    repositoryId,
    repository: contribution.repository,
    repositoryUrl: contribution.repositoryUrl,
    ...(repositoryDescription !== undefined && { repositoryDescription }),
    authored,
  };
}

function cleanTitle(value: string, warn: (message: string) => void): string | undefined {
  const text = withoutControlCharacters(value).replace(/\s+/g, " ").trim();
  if (text === "") return undefined;
  if (text.length <= NORMALIZE_LIMITS.titleChars) return text;
  warn(`title cut to ${NORMALIZE_LIMITS.titleChars} characters`);
  return `${text.slice(0, NORMALIZE_LIMITS.titleChars - 1).trimEnd()}…`;
}

/** Control characters become spaces (they are invisible and can hide text). */
function withoutControlCharacters(text: string, keepNewlines = false): string {
  return text.replace(keepNewlines ? CONTROL_EXCEPT_NEWLINE_AND_TAB : CONTROL, " ");
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_EXCEPT_NEWLINE_AND_TAB = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function cleanDescription(
  value: string | null,
  warn: (message: string) => void,
): string | undefined {
  if (value === null) return undefined;
  const text = withoutControlCharacters(value).replace(/\s+/g, " ").trim();
  if (text === "") return undefined;
  if (text.length <= NORMALIZE_LIMITS.descriptionChars) return text;
  warn(`description cut to ${NORMALIZE_LIMITS.descriptionChars} characters`);
  return `${text.slice(0, NORMALIZE_LIMITS.descriptionChars - 1).trimEnd()}…`;
}

/** GitHub accepts any text as a homepage; only an http or https URL is kept. */
function cleanHomepage(value: string | null, warn: (message: string) => void): string | undefined {
  const text = value?.trim() ?? "";
  if (text === "") return undefined;
  if (/^https?:\/\//i.test(text) && URL.canParse(text) && text.length <= 2048) return text;
  warn("homepage dropped: not an http or https URL");
  return undefined;
}

/** `YYYY-MM` in UTC: the month is enough, and a daily push does not change the profile. */
function monthOf(timestamp: string | null): PartialDate | undefined {
  if (timestamp === null) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The largest languages by bytes, as whole percents; shares under 1 percent are dropped. */
function languageShares(bytesByLanguage: Record<string, number>): LanguageShare[] {
  const entries = Object.entries(bytesByLanguage).filter(
    ([name, bytes]) => name.trim() !== "" && bytes > 0,
  );
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (total === 0) return [];
  return entries
    .sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB))
    .map(([name, bytes]) => ({ name: name.trim(), percent: Math.round((bytes / total) * 100) }))
    .filter((share) => share.percent >= 1)
    .slice(0, NORMALIZE_LIMITS.languages);
}

/**
 * The beginning of a README as plain text: images, HTML, comments, and badge links removed,
 * blank lines collapsed, cut at a line break before the limit.
 */
export function readmeExcerpt(
  raw: string | null,
  alreadyTruncated = false,
): { text: string; truncated: boolean } | undefined {
  if (raw === null) return undefined;
  const cleaned = withoutControlCharacters(raw.replace(/\r\n?/g, "\n"), true)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
    .replace(/<[^>\n]+>/g, "")
    .replace(/\[\s*\]\([^)]*\)/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned === "") return undefined;
  if (cleaned.length <= NORMALIZE_LIMITS.readmeChars) {
    return { text: cleaned, truncated: alreadyTruncated };
  }
  const head = cleaned.slice(0, NORMALIZE_LIMITS.readmeChars);
  const lastBreak = head.lastIndexOf("\n");
  const cut = lastBreak >= NORMALIZE_LIMITS.readmeMinCutChars ? head.slice(0, lastBreak) : head;
  return { text: cut.trimEnd(), truncated: true };
}
