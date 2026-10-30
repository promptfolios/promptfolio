import { handleContactSend } from "@promptfolio/contact";
import { withContactOptions } from "@/server/contact";

/** Upper bound, in seconds, on serverless hosts. The provider call times out well before it. */
export const maxDuration = 15;

/** Sends the email inside a confirmation token, the only thing this route accepts. */
export async function POST(request: Request): Promise<Response> {
  return withContactOptions((options) => handleContactSend(request, options));
}
