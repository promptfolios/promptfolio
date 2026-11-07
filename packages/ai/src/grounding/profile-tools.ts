import {
  type Contribution,
  type Education,
  findRecordById,
  isRecordId,
  type Profile,
  type ProfileLink,
  type Project,
  type Provenance,
  type Repository,
  type Role,
  recordsUsingSkill,
  type Skill,
} from "@promptfolio/core";
import { type Tool, tool } from "ai";
import { z } from "zod";
import type {
  ContributionSummary,
  EducationSummary,
  LinkSummary,
  ProjectSummary,
  RecordEvidence,
  RecordSummary,
  RepositorySummary,
  RoleSummary,
  SkillSummary,
  SourceSummary,
} from "./record-summaries.ts";

/**
 * Read-only lookup tools over the validated profile. The model can only ask for a call;
 * the AI SDK validates the arguments against `inputSchema` and runs `execute` here, on the
 * server. Tool arguments come from the model and are treated as lookup keys, nothing more.
 *
 * Expected outcomes ("not found", "budget used up") are results the model can read and
 * explain, not exceptions. `execute` throws only on a bug.
 */

const SECTIONS = [
  "experience",
  "projects",
  "repositories",
  "contributions",
  "education",
  "skills",
  "links",
] as const;
const SKILL_FILTER_SECTIONS: ReadonlySet<string> = new Set([
  "experience",
  "projects",
  "repositories",
]);

export const listInputSchema = z
  .strictObject({
    section: z.enum(SECTIONS).describe("Which part of the profile to list."),
    skill: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Only for experience, projects, or repositories: keep the records that list this skill " +
          "(for repositories: as a language or topic).",
      ),
  })
  .refine((input) => input.skill === undefined || SKILL_FILTER_SECTIONS.has(input.section), {
    message: "skill can only be used with the experience, projects, or repositories section",
    path: ["skill"],
  });

export const getInputSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The exact id of a role, project, education entry, repository, or contribution, as returned by a list.",
    ),
});

const LIMIT_REACHED = {
  status: "limit_reached",
  message:
    "The lookup limit for this question is reached. Answer with the records already returned.",
} as const;

export interface ProfileToolsOptions {
  /** Calls allowed in one chat request; later calls return `limit_reached` without work. */
  maxCalls: number;
}

export type ProfileTools = {
  listProfileRecords: Tool<
    z.input<typeof listInputSchema>,
    ReturnType<typeof listRecords> | typeof LIMIT_REACHED
  >;
  getProfileRecord: Tool<
    z.input<typeof getInputSchema>,
    ReturnType<typeof getRecord> | typeof LIMIT_REACHED
  >;
};

/**
 * Creates the tool set for one chat request. The call budget lives in this closure, so it
 * is counted per request and cannot be reset by the model or the client.
 */
export function createProfileTools(
  profile: Profile,
  { maxCalls }: ProfileToolsOptions,
): ProfileTools {
  let calls = 0;
  const withinBudget = () => {
    calls += 1;
    return calls <= maxCalls;
  };

  return {
    listProfileRecords: tool({
      description:
        "List the owner's records in one profile section, with ids, descriptions, and dates. " +
        "Projects include their links and repositories their url. Use getProfileRecord with " +
        "an id only for highlights, responsibilities, outcomes, or a repository's README.",
      inputSchema: listInputSchema,
      execute: async (input) => (withinBudget() ? listRecords(profile, input) : LIMIT_REACHED),
    }),
    getProfileRecord: tool({
      description:
        "Get the full details of one role, project, education entry, repository, or contribution by its exact id.",
      inputSchema: getInputSchema,
      execute: async ({ id }) => (withinBudget() ? getRecord(profile, id) : LIMIT_REACHED),
    }),
  };
}

function listRecords(profile: Profile, input: z.infer<typeof listInputSchema>) {
  const records = selectSection(profile, input);
  const result = {
    status: "listed" as const,
    section: input.section,
    records: records.map((record) => record.summary),
    sources: sourcesFor(profile, records),
  };
  if (input.skill === undefined) return result;
  return { ...result, skillInProfile: recordsUsingSkill(profile, input.skill).inProfile };
}

/** Summaries of one section, each with the provenance it came from. */
function selectSection(
  profile: Profile,
  { section, skill }: z.infer<typeof listInputSchema>,
): Array<{ summary: RecordSummary; provenance: Provenance }> {
  const usage = skill === undefined ? undefined : recordsUsingSkill(profile, skill);
  switch (section) {
    case "experience":
      return (usage?.roles ?? profile.experience).map((role) => ({
        summary: summarizeRole(role),
        provenance: role.provenance,
      }));
    case "projects":
      return (usage?.projects ?? profile.projects).map((project) => ({
        summary: summarizeProject(project),
        provenance: project.provenance,
      }));
    case "repositories":
      return (usage?.repositories ?? profile.repositories).map((repository) => ({
        summary: summarizeRepository(repository, profile),
        provenance: repository.provenance,
      }));
    case "contributions":
      return profile.contributions.map((contribution) => ({
        summary: summarizeContribution(contribution, profile),
        provenance: contribution.provenance,
      }));
    case "education":
      return profile.education.map((entry) => ({
        summary: summarizeEducation(entry),
        provenance: entry.provenance,
      }));
    case "skills":
      return profile.skills.map((skill) => ({
        summary: summarizeSkill(skill),
        provenance: skill.provenance,
      }));
    case "links":
      return profile.links.map((link) => ({
        summary: summarizeLink(link),
        provenance: link.provenance,
      }));
  }
}

function getRecord(profile: Profile, id: string) {
  const match = isRecordId(id) ? findRecordById(profile, id) : undefined;
  if (match === undefined) {
    return {
      status: "not_found" as const,
      id,
      message:
        "No role, project, education entry, repository, or contribution has this id. Do not guess a similar one.",
    };
  }

  if (match.kind === "repository" || match.kind === "contribution") {
    const { provenance, ...fields } = match.record;
    // The owner's project for this repository: their own description of it.
    const notes = match.ownerNotes;
    return {
      status: "found" as const,
      kind: match.kind,
      record: { ...fields, ...evidence(provenance) },
      ...(notes !== undefined && { ownerNotes: projectDetails(notes) }),
      sources: sourcesFor(profile, notes === undefined ? [match.record] : [match.record, notes]),
    };
  }

  const { provenance, ...fields } = match.record;
  // A project done under a role also returns that role's summary, so the model can name it.
  const role =
    match.kind === "project" && match.record.roleId !== undefined
      ? profile.experience.find((entry) => entry.id === match.record.roleId)
      : undefined;

  return {
    status: "found" as const,
    kind: match.kind,
    record: { ...fields, ...evidence(provenance) },
    ...(role !== undefined && { role: summarizeRole(role) }),
    sources: sourcesFor(profile, role === undefined ? [match.record] : [match.record, role]),
  };
}

/*
 * Summaries hold everything a basic answer needs (what, where, when), so a section question
 * can be answered after one lookup. Long lists (highlights, responsibilities, outcomes) stay in
 * getProfileRecord, to keep list results small.
 *
 * Project links are the exception: answers show sources as Markdown links to tool-result urls
 * (ADR 0014), and weaker models often answer straight after the list without a get. So a
 * project's links come with its summary, as a repository's url already does.
 */

function summarizeRole(role: Role): RoleSummary {
  return {
    id: role.id,
    organization: role.organization,
    title: role.title,
    start: role.start,
    ...(role.end !== undefined && { end: role.end }),
    ...(role.summary !== undefined && { summary: role.summary }),
    ...evidence(role.provenance),
  };
}

function summarizeProject(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    ...(project.roleId !== undefined && { roleId: project.roleId }),
    skills: project.skills,
    links: project.links,
    ...evidence(project.provenance),
  };
}

function summarizeRepository(repository: Repository, profile: Profile): RepositorySummary {
  return {
    id: repository.id,
    name: repository.name,
    ...(repository.description !== undefined && { description: repository.description }),
    url: repository.url,
    languages: repository.languages,
    topics: repository.topics,
    ...(repository.archived && { archived: true }),
    ...(repository.lastActivity !== undefined && { lastActivity: repository.lastActivity }),
    ...(repository.license !== undefined && { license: repository.license }),
    hasOwnerNotes: profile.projects.some((project) => project.id === repository.id),
    ...evidence(repository.provenance),
  };
}

function summarizeContribution(contribution: Contribution, profile: Profile): ContributionSummary {
  return {
    id: contribution.id,
    title: contribution.title,
    url: contribution.url,
    repositoryId: contribution.repositoryId,
    repository: contribution.repository,
    repositoryUrl: contribution.repositoryUrl,
    ...(contribution.repositoryDescription !== undefined && {
      repositoryDescription: contribution.repositoryDescription,
    }),
    authored: contribution.authored,
    hasOwnerNotes: profile.projects.some((project) => project.id === contribution.repositoryId),
    ...evidence(contribution.provenance),
  };
}

/** A full project with its provenance flattened, as getProfileRecord returns it. */
function projectDetails(project: Project) {
  const { provenance, ...fields } = project;
  return { ...fields, ...evidence(provenance) };
}

function summarizeEducation(entry: Education): EducationSummary {
  return {
    id: entry.id,
    institution: entry.institution,
    credential: entry.credential,
    ...(entry.field !== undefined && { field: entry.field }),
    ...(entry.start !== undefined && { start: entry.start }),
    ...(entry.end !== undefined && { end: entry.end }),
    ...evidence(entry.provenance),
  };
}

function summarizeSkill(skill: Skill): SkillSummary {
  return {
    name: skill.name,
    ...(skill.category !== undefined && { category: skill.category }),
    ...evidence(skill.provenance),
  };
}

function summarizeLink(link: ProfileLink): LinkSummary {
  return {
    label: link.label,
    url: link.url,
    ...evidence(link.provenance),
  };
}

function evidence(provenance: Provenance): RecordEvidence {
  return {
    basis: provenance.basis,
    sourceId: provenance.sourceId,
    observedAt: provenance.observedAt,
  };
}

/** The sources the given records came from, once each, in profile order. */
function sourcesFor(profile: Profile, records: Array<{ provenance: Provenance }>): SourceSummary[] {
  const ids = new Set(records.map((record) => record.provenance.sourceId));
  return profile.sources
    .filter((source) => ids.has(source.id))
    .map(({ id, kind, label }) => ({ id, kind, label }));
}
