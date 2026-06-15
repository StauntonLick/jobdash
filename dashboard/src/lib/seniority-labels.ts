// Seniority levels that can be safely imported on both client and server.
// Ordered from most junior to most senior for display purposes.
export const SENIORITY_LABELS = [
  "Intern",
  "Junior",
  "Mid",
  "Senior",
  "Principal",
  "Lead",
  "Manager",
] as const;

export type SeniorityLabel = (typeof SENIORITY_LABELS)[number];
