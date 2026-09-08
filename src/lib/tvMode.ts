export const TV_MODE_STORAGE_KEY = 'dart-tv-mode-v1';

export function isTVModeEnabled(): boolean {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(TV_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

// Call directly from the Start click, before awaiting game creation, so the
// browser still has the user activation required for fullscreen.
export function requestTVModeFullscreen(): void {
  if (!isTVModeEnabled() || typeof document === 'undefined' || document.fullscreenElement) return;
  try {
    void document.documentElement.requestFullscreen?.().catch(() => {
      // Fullscreen may be unavailable or denied; still open the spectator view.
    });
  } catch {
    // A fullscreen failure must not prevent game creation.
  }
}
