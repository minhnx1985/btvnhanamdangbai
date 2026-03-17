export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function normalizeDecision(text: string): "yes" | "no" | "unknown" {
  const normalized = text.trim().toLowerCase();

  if (["y", "yes"].includes(normalized)) {
    return "yes";
  }

  if (["n", "no"].includes(normalized)) {
    return "no";
  }

  return "unknown";
}
