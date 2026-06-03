/**
 * Lightweight analytics shim. No-ops unless an analytics script is loaded
 * (see <Analytics />). Targets Plausible's `window.plausible` queue API, so
 * events fired before the script finishes loading are still captured.
 */
declare global {
  interface Window {
    plausible?: ((
      event: string,
      options?: { props?: Record<string, string | number | boolean> },
    ) => void) & { q?: unknown[] };
  }
}

export function track(
  event: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    /* analytics must never break the app */
  }
}
