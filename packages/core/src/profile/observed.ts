import { type ProfileIssue, type ProfileLoadResult, toProfileIssue } from "./load";
import { isSourceKey, observedRecordsSchema } from "./schema";
import type {
  ExternalLink,
  Profile,
  ProfileLink,
  Provenance,
  Repository,
  SourceRef,
} from "./types";

/** Describes an external source whose records are added to a profile. */
export interface ObservedSource {
  /** Stable id for the source, referenced by every record's provenance. Must be new. */
  id: string;
  /** Source type, for example `"github"`. */
  kind: string;
  /** Human-readable description, for example "Public GitHub data for @jordan". */
  label: string;
  url?: string;
  /** When the source was read. */
  retrievedAt: Date;
}

/**
 * A repository as a source adapter produces it: everything except provenance, plus an optional
 * `observedAt` for a repository read earlier than the rest of the source (a refresh that kept
 * the previous data for it). Defaults to the source's `retrievedAt`.
 */
export type RepositoryInput = Omit<Repository, "provenance"> & { observedAt?: Date };

/** Records observed in one external source, in the canonical shape. */
export interface ObservedRecords {
  source: ObservedSource;
  links?: ExternalLink[];
  repositories?: RepositoryInput[];
}

/**
 * Validates records observed in an external source, stamps them `source-observed`, and adds
 * them to a copy of the profile. The input profile is not modified.
 *
 * Owner records are never changed or replaced: an observed link whose URL the owner already
 * lists is skipped, and a project whose id equals a repository's id stays a separate record
 * (the owner's description of that repository).
 *
 * @param profile A profile from `loadStructuredProfile` (or a previous call of this function).
 * @param records Untrusted records produced by a source adapter.
 * @throws {TypeError} If `records.source` is invalid (a programming error, not a data error).
 */
export function addObservedRecords(profile: Profile, records: ObservedRecords): ProfileLoadResult {
  const { source } = records;
  assertValidSource(source);

  const parsed = observedRecordsSchema.safeParse({
    links: records.links ?? [],
    repositories: records.repositories ?? [],
  });
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(toProfileIssue) };
  }
  const { links, repositories } = parsed.data;

  const issues = [
    ...findIdConflicts(profile, repositories),
    ...findLateObservations(repositories, source.retrievedAt),
  ];
  if (profile.sources.some((existing) => existing.id === source.id)) {
    issues.unshift({
      path: "source.id",
      message: `Source '${source.id}' is already in the profile`,
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const retrievedAt = source.retrievedAt.toISOString();
  // A fresh object per record, so modifying one record's provenance cannot affect another.
  const provenance = (observedAt = retrievedAt): Provenance => ({
    sourceId: source.id,
    basis: "source-observed",
    observedAt,
  });
  const sourceRef: SourceRef = {
    id: source.id,
    kind: source.kind,
    label: source.label,
    retrievedAt,
    ...(source.url !== undefined && { url: source.url }),
  };

  const knownUrls = new Set(profile.links.map((link) => comparableUrl(link.url)));
  const newLinks: ProfileLink[] = links
    .filter((link) => !knownUrls.has(comparableUrl(link.url)))
    .map((link) => ({ ...link, provenance: provenance() }));
  const newRepositories: Repository[] = repositories.map(({ observedAt, ...repository }) => ({
    ...repository,
    languages: repository.languages.map((language) => ({ ...language })),
    topics: [...repository.topics],
    provenance: provenance(observedAt?.toISOString()),
  }));

  const merged: Profile = {
    ...profile,
    links: [...profile.links, ...newLinks],
    repositories: [...profile.repositories, ...newRepositories],
    sources: [...profile.sources, sourceRef],
  };
  return { ok: true, profile: merged, warnings: findUnmatchedAnnotations(merged, source) };
}

function assertValidSource(source: ObservedSource): void {
  if (source.id.trim() === "") {
    throw new TypeError("source.id must not be empty");
  }
  if (source.kind.trim() === "" || source.label.trim() === "") {
    throw new TypeError("source.kind and source.label must not be empty");
  }
  if (Number.isNaN(source.retrievedAt.getTime())) {
    throw new TypeError("source.retrievedAt must be a valid date");
  }
}

/**
 * Repository ids must be new. Only a project may share a repository's id: that project is
 * the owner's description of the repository. A role or education entry may not.
 */
function findIdConflicts(profile: Profile, repositories: RepositoryInput[]): ProfileIssue[] {
  const taken = new Map<string, string>();
  for (const role of profile.experience) taken.set(role.id, "a role");
  for (const entry of profile.education) taken.set(entry.id, "an education entry");
  for (const repository of profile.repositories) taken.set(repository.id, "a repository");

  const issues: ProfileIssue[] = [];
  repositories.forEach((repository, index) => {
    const usedBy = taken.get(repository.id);
    if (usedBy !== undefined) {
      issues.push({
        path: `repositories[${index}].id`,
        message: `Id '${repository.id}' is already used by ${usedBy}`,
      });
    }
    taken.set(repository.id, "a repository");
  });
  return issues;
}

/** A repository cannot have been observed after its source was read. */
function findLateObservations(repositories: RepositoryInput[], retrievedAt: Date): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  repositories.forEach((repository, index) => {
    if (repository.observedAt !== undefined && repository.observedAt > retrievedAt) {
      issues.push({
        path: `repositories[${index}].observedAt`,
        message: "Observed after the source was retrieved",
      });
    }
  });
  return issues;
}

/**
 * Projects whose id is a source key on this source's host but match no repository: usually a
 * renamed, deleted, private, or unselected repository. The project still loads.
 */
function findUnmatchedAnnotations(profile: Profile, source: ObservedSource): ProfileIssue[] {
  const hosts = new Set(profile.repositories.map((repository) => hostOf(repository.id)));
  // core has no URL type (no DOM or Node types), and the host is all that is needed here.
  const sourceHost = source.url?.match(/^https?:\/\/([^/?#:]+)/i)?.[1];
  if (sourceHost !== undefined) hosts.add(sourceHost.toLowerCase());
  const repositoryIds = new Set(profile.repositories.map((repository) => repository.id));

  const warnings: ProfileIssue[] = [];
  profile.projects.forEach((project, index) => {
    if (
      isSourceKey(project.id) &&
      hosts.has(hostOf(project.id)) &&
      !repositoryIds.has(project.id)
    ) {
      warnings.push({
        path: `projects[${index}].id`,
        message: `No repository '${project.id}' in ${source.label}`,
      });
    }
  });
  return warnings;
}

function hostOf(sourceKey: string): string {
  return sourceKey.slice(0, sourceKey.indexOf("/"));
}

/** URLs compared without case and trailing slashes, so `…/Jordan/` equals `…/jordan`. */
function comparableUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}
