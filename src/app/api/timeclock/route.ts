import { getAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { isAllowedUser } from "@/lib/access-policy";
import { getTimeclock } from "@/lib/timeclock/server";
import { TimeclockError } from "@/lib/timeclock/store";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "private, no-store" },
});
async function owner(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session || !isAllowedUser(session.user, getEnv().ALLOWED_EMAIL)) {
    throw new TimeclockError(401, "Please sign in again.");
  }
  return session.user.id;
}
function failure(error: unknown) {
  if (error instanceof TimeclockError) return json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return json({ error: "The request could not be read. Please try again." }, 400);
  if (error && typeof error === "object" && "code" in error && error.code === 11000) {
    return json({ error: "Another request changed this item. Refresh and try again." }, 409);
  }
  // Do not expose driver messages, credentials, or private data in responses.
  console.error("Timeclock request failed:", error instanceof Error ? error.name : "UnknownError");
  return json({ error: "Couldn’t reach your workspace. Please try again." }, 503);
}
export async function GET(request: Request) {
  try {
    const userId = await owner(request);
    const params = new URL(request.url).searchParams;
    if (params.get("format") === "csv") {
      const projectId = params.get("projectId") ?? undefined;
      if (projectId !== undefined && !z.uuid().safeParse(projectId).success) throw new TimeclockError(400, "Choose a valid project.");
      const csv = await getTimeclock().exportCsv(userId, projectId);
      return new Response(csv, { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="timeclock-${projectId ? "project" : "all-projects"}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    return json(await getTimeclock().snapshot(userId));
  }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(getEnv().BETTER_AUTH_URL).origin) {
      throw new TimeclockError(403, "This request must come from your Timeclock app.");
    }
    const userId = await owner(request);
    const body = await request.text();
    if (body.length > 4096) throw new TimeclockError(413, "This request is too large.");
    return json(await getTimeclock().execute(userId, JSON.parse(body)));
  } catch (error) { return failure(error); }
}
