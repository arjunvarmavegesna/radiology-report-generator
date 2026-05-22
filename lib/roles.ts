import type { Role } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  radiologist: "Radiologist",
  typist: "Typist",
  reviewer: "Reviewer",
};

/** Landing route for each role after login. */
export const ROLE_HOME: Record<Role, string> = {
  radiologist: "/radiologist/new",
  typist: "/typist/queue",
  reviewer: "/reviewer/queue",
};

export function roleHome(role: Role | null | undefined): string {
  if (!role) return "/login";
  return ROLE_HOME[role] ?? "/login";
}
