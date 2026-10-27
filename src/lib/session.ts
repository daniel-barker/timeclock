import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { isAllowedUser } from "@/lib/access-policy";

export async function requireSession() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session || !isAllowedUser(session.user, getEnv().ALLOWED_EMAIL)) {
    redirect("/login");
  }
  return session;
}
