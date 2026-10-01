/**
 * Minimal error reporting used by the route error boundaries.
 * Errors are logged with their boundary and context so they are visible in the
 * browser console during a demonstration.
 */
export function reportAppError(error: unknown, context: Record<string, unknown> = {}): void {
  if (typeof console === "undefined") return;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("[AccessLens]", detail, context);
  if (error instanceof Error && error.stack) console.error(error.stack);
}
