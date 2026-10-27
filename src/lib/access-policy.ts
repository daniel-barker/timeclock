export function isAllowedUser(
  user: { email: string; emailVerified: boolean } | null | undefined,
  allowedEmail: string,
) {
  return Boolean(
    user?.emailVerified && allowedEmail.trim() &&
    user.email.trim().toLowerCase() === allowedEmail.trim().toLowerCase(),
  );
}
