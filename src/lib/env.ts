import "server-only";
import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  MONGODB_DB: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z.email().transform((value) => value.toLowerCase()),
});

export function getEnv() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    // Report field names only, never secret values.
    throw new Error(`Check these settings in .env.local: ${fields.join(", ")}`);
  }
  return result.data;
}
