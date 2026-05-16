export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "").trim().toLowerCase();
}

export function formatSubjectName(subject: string | null | undefined): string {
  const trimmed = (subject ?? "").trim();
  if (!trimmed) return "";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}
