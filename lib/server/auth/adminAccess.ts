// Admin allowlist — configured via the ADMIN_EMAILS env (comma-separated),
// never hardcoded, so the admin set stays out of source control and is
// rotatable per environment. Comparison is lower-cased + trimmed.
function adminEmailSet(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailSet().has(email.trim().toLowerCase());
}
