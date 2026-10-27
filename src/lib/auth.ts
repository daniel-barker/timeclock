import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { getEnv } from "@/lib/env";
import { getDatabase, getMongoClient } from "@/lib/mongodb";
import { isAllowedUser } from "@/lib/access-policy";

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "Timeclock",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: mongodbAdapter(getDatabase(), { client: getMongoClient() }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    emailAndPassword: { enabled: false },
    account: { accountLinking: { enabled: false } },
    session: { cookieCache: { enabled: false } },
    advanced: { database: { generateId: "uuid" } },
    onAPIError: { errorURL: "/login?error=signin" },
    databaseHooks: {
      user: { create: { before: async (user) => {
        if (!isAllowedUser(user, env.ALLOWED_EMAIL)) {
          throw new APIError("FORBIDDEN", { message: "This account does not have access to Timeclock." });
        }
      } } },
      session: { create: { before: async (session, context) => {
        const user = await context?.context.internalAdapter.findUserById(session.userId);
        if (!isAllowedUser(user, env.ALLOWED_EMAIL)) {
          throw new APIError("FORBIDDEN", { message: "This account does not have access to Timeclock." });
        }
      } } },
    },
  });
}

let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  // Build without connecting to the database or requiring live credentials.
  return (auth ??= createAuth());
}
