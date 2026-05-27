import type { Place } from "./types";

/** Lightweight module-level store that carries a user-chosen custom pickup
 *  between screens without needing context or route params. Cleared whenever
 *  the user explicitly returns to GPS, or after the ride is created. */
let _custom: Place | null = null;

export const pickupStore = {
  get: (): Place | null => _custom,
  set: (p: Place | null): void => {
    _custom = p;
  },
  clear: (): void => {
    _custom = null;
  },
};
