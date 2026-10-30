import { handleContactPrepare } from "@promptfolio/contact";
import { withContactOptions } from "@/server/contact";

/** Validates a contact draft and returns it for review. Sends nothing. */
export async function POST(request: Request): Promise<Response> {
  return withContactOptions((options) => handleContactPrepare(request, options));
}
