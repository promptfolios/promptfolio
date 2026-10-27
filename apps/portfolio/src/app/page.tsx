import type { Profile, ProfileIssue } from "@promptfolio/core";
import { loadAppProfile } from "../server/profile";

// Temporary diagnostic page: shows that the profile loads through the public API.
// Replaced by the chat workspace in M3.
export default async function HomePage() {
  const { fileName, result } = await loadAppProfile();

  return (
    <main>
      <h1>Promptfolio</h1>
      <p>Profile file: {fileName}</p>
      {result.ok ? (
        <>
          <ProfileSummary profile={result.profile} />
          {result.warnings.length > 0 && <IssueList title="Warnings" issues={result.warnings} />}
        </>
      ) : (
        <IssueList title="The profile could not be loaded" issues={result.issues} />
      )}
    </main>
  );
}

function ProfileSummary({ profile }: { profile: Profile }) {
  return (
    <section>
      <h2>{profile.identity.name}</h2>
      <p>{profile.identity.headline}</p>
      <ul>
        <li>Roles: {profile.experience.length}</li>
        <li>Projects: {profile.projects.length}</li>
        <li>Skills: {profile.skills.length}</li>
        <li>Education: {profile.education.length}</li>
      </ul>
    </section>
  );
}

function IssueList({ title, issues }: { title: string; issues: ProfileIssue[] }) {
  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.path}:${issue.message}`}>
            <code>{issue.path}</code>: {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
