import {
  type ClaimBasis,
  type Contribution,
  type Education,
  findRecordById,
  isRecordId,
  type Profile,
  type Project,
  type Provenance,
  type Repository,
  type Role,
  recordsUsingSkill,
} from "@promptfolio/core";
import { tool } from "ai";
import { z } from "zod";

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

/**
 * The full provenance every returned record carries, flattened onto the record, so an answer
 * can say whose claim it is and when it was observed without another lookup.
 */
interface RecordEvidence {
  basis: ClaimBasis;
  sourceId: string;
  observedAt: string;
}

interface SourceSummary {
  id: string;
  kind: string;
  label: string;
}

const LIMIT_REACHED = {
  status: "limit_reached",
  message:
    "The lookup limit for this question is reached. Answer with the records already returned.",
} as const;

export interface ProfileToolsOptions {
  /** Calls allowed in one chat request; later calls return `limit_reached` without work. */
  maxCalls: number;
}

/**
 * Creates the tool set for one chat request. The call budget lives in this closure, so it
 * is counted per request and cannot be reset by the model or the client.
 */
export function createProfileTools(profile: Profile, { maxCalls }: ProfileToolsOptions) {
  let calls = 0;
  const withinBudget = () => {
    calls += 1;
    return calls <= maxCalls;
  };

  return {
    listProfileRecords: tool({
      description:
        "List the owner's records in one profile section, with ids, descriptions, and dates. " +
        "Use getProfileRecord with an id only for highlights, responsibilities, outcomes, " +
        "links, or a repository's README.",
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
): Array<{ summary: object; provenance: Provenance }> {
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
      return profile.skills.map(({ provenance, ...skill }) => ({
        summary: { ...skill, ...evidence(provenance) },
        provenance,
      }));
    case "links":
      return profile.links.map(({ provenance, ...link }) => ({
        summary: { ...link, ...evidence(provenance) },
        provenance,
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
 * can be answered after one lookup. Lists (highlights, responsibilities, outcomes, links) stay
 * in getProfileRecord, to keep list results small.
 */

function summarizeRole(role: Role) {
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

function summarizeProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    ...(project.roleId !== undefined && { roleId: project.roleId }),
    skills: project.skills,
    ...evidence(project.provenance),
  };
}

function summarizeRepository(repository: Repository, profile: Profile) {
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

function summarizeContribution(contribution: Contribution, profile: Profile) {
  const { provenance, repositoryId, ...fields } = contribution;
  return {
    ...fields,
    repositoryId,
    hasOwnerNotes: profile.projects.some((project) => project.id === repositoryId),
    ...evidence(provenance),
  };
}

/** A full project with its provenance flattened, as getProfileRecord returns it. */
function projectDetails(project: Project) {
  const { provenance, ...fields } = project;
  return { ...fields, ...evidence(provenance) };
}

function summarizeEducation(entry: Education) {
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
