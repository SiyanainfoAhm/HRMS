/** Legacy browser-storage key from before auth moved to httpOnly cookies. It must never be trusted or left behind. */
export const LEGACY_AUTH_STORAGE_KEY = "hrms_token";

type RemovableStorage = { removeItem(key: string): void };

/** Removes the legacy token from local and session storage. Blocked/unavailable storage is ignored. */
export function clearLegacyAuthStorage(local: RemovableStorage, session: RemovableStorage): void {
  for (const store of [local, session]) {
    try {
      store.removeItem(LEGACY_AUTH_STORAGE_KEY);
    } catch {
      /* storage can be blocked (private mode, policy); the cookies are what matter */
    }
  }
}
