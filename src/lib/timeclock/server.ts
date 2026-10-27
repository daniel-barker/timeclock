import "server-only";
import { getDatabase, getMongoClient } from "@/lib/mongodb";
import { createTimeclockStore } from "./store";
let store: ReturnType<typeof createTimeclockStore> | undefined;
export function getTimeclock() {
  return (store ??= createTimeclockStore(getDatabase(), getMongoClient()));
}
