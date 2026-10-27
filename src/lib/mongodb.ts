import "server-only";
import { MongoClient } from "mongodb";
import { getEnv } from "@/lib/env";

const shared = globalThis as typeof globalThis & { timeclockMongo?: MongoClient };

export function getMongoClient() {
  if (!shared.timeclockMongo) {
    shared.timeclockMongo = new MongoClient(getEnv().MONGODB_URI, {
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 10_000,
    });
  }
  // The driver connects on the first operation and reuses its pool.
  return shared.timeclockMongo;
}

export function getDatabase() {
  return getMongoClient().db(getEnv().MONGODB_DB);
}
