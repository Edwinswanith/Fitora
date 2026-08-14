// Role to route mapping. Existing accounts always route by the role returned
// from the server. First-time Google sign-ups use the selected role page.

export type Role = "coach" | "athlete" | "guardian";

export const ROLES: Role[] = ["coach", "athlete", "guardian"];

export const ROLE_DASHBOARDS: Record<Role, string> = {
  coach: "/coach/dashboard",
  athlete: "/athlete/dashboard",
  guardian: "/guardian/dashboard",
};

export function dashboardPathForRole(role: string): string | null {
  return (ROLE_DASHBOARDS as Record<string, string>)[role] ?? null;
}

export function isKnownRole(role: string): role is Role {
  return role in ROLE_DASHBOARDS;
}
