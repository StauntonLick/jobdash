const PATTERNS = [
  /\bAI\b/g,
  /\bagentic\b/gi,
  /\bLLM\b/gi,
  /\bClaude\b/gi,
  /\bCursor\b/gi,
  /\bChatGPT\b/gi,
  /\bOpenAI\b/gi,
  /\bGemini\b/gi,
  /\bCopilot\b/gi,
  /\bvibe\s+cod(?:e|ing)\b/gi,
];

export function countAiKeywords(description: string): number {
  return PATTERNS.reduce((total, pattern) => {
    const matches = description.match(new RegExp(pattern.source, pattern.flags));
    return total + (matches?.length ?? 0);
  }, 0);
}

export function aiLevelFromCount(count: number): 0 | 1 | 2 | 3 {
  if (count >= 8) return 3;
  if (count >= 4) return 2;
  if (count >= 1) return 1;
  return 0;
}
