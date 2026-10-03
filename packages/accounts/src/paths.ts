import { join, resolve } from "node:path";
import { isUserId } from "./store.js";

/** A user's folders (cloud mode): run artifacts, saved site accesses and search settings. */
export interface UserDirs {
  root: string;
  runs: string;
  access: string;
  search: string;
}

export function userDirs(dataDir: string, userId: string): UserDirs {
  if (!isUserId(userId)) throw new Error("userDirs: not a user id");
  const root = join(resolve(dataDir), "users", userId.toLowerCase());
  return { root, runs: join(root, "runs"), access: join(root, "access"), search: join(root, "search") };
}
