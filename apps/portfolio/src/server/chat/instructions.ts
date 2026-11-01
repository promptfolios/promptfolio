/**
 * What the assistant needs to know about this page. The model cannot see it, so it hears about the
 * Contact button only when the same check that shows the button says it exists.
 */
export function chatInstructions(contactEnabled: boolean): string | undefined {
  return contactEnabled
    ? "This page has a Contact button at the top. When a visitor wants to contact the profile owner, point them to it as well."
    : undefined;
}
