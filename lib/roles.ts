import type { Role } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  radiologist: "Radiologist",
  typist: "Typist",
  reviewer: "Reviewer",
};

/** Single-role app — every signed-in user lands on /capture regardless of
 *  their legacy role claim. The Role type stays around so existing custom
 *  claims and users/{uid} docs are still readable. */
export const WORKSPACE_HOME = "/capture";

export function roleHome(role: Role | null | undefined): string {
  return role ? WORKSPACE_HOME : "/login";
}
