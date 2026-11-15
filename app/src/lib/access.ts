import type { Role } from "./types";

export const STAFF_ONLY: Role[] = ["staff", "vet"];
export const EVERYONE: Role[] = ["staff", "vet", "family"];

export function roleFromGroups(groups: string[]): Role {
  if (groups.includes("vet")) return "vet";
  if (groups.includes("staff")) return "staff";
  return "family";
}
