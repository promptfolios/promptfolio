import type { ProfileIssue } from "@promptfolio/core";
import { ChatWorkspace } from "@/components/chat-workspace";
import { loadAppProfile } from "@/server/profile";

export default async function HomePage() {
  const { fileName, result } = await loadAppProfile();

  if (!result.ok) {
    return <ProfileErrorPage fileName={fileName} issues={result.issues} />;
  }

  // Warnings are for the profile owner, not visitors: log them on the server.
  for (const warning of result.warnings) {
    console.warn(`[profile] ${fileName}: ${warning.path}: ${warning.message}`);
  }

  const { identity } = result.profile;
  return <ChatWorkspace ownerName={identity.name} headline={identity.headline} />;
}

/** Shown to the profile owner when the configured profile cannot be loaded. */
function ProfileErrorPage({ fileName, issues }: { fileName: string; issues: ProfileIssue[] }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">The profile could not be loaded</h1>
      <p className="text-muted-foreground mt-1">Profile file: {fileName}</p>
      <ul className="mt-4 list-disc space-y-1 pl-5">
        {issues.map((issue) => (
          <li key={`${issue.path}:${issue.message}`}>
            <code>{issue.path}</code>: {issue.message}
          </li>
        ))}
      </ul>
    </main>
  );
}
