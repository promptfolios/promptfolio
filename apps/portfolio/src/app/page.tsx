import { coreInfo } from "@promptfolio/core";

export default function HomePage() {
  return (
    <main>
      <h1>Promptfolio</h1>
      <p>Workspace check: imported {coreInfo.name} through its public entry point.</p>
    </main>
  );
}
