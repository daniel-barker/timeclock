import { requireSession } from "@/lib/session";
import { Workspace } from "@/components/timeclock/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const { user } = await requireSession();
  return <Workspace name={user.name || "Your account"} />;
}
