export const RECALL_FADE_MIN_DEPTH = 2

export function resolveFadeMinDepth(value: unknown): number {
  if (value == null) return RECALL_FADE_MIN_DEPTH
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : RECALL_FADE_MIN_DEPTH
}
