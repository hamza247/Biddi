import { useWindowDimensions } from "react-native";

/**
 * Returns a screen-proportional translateY offset for slide-in / bounce
 * animations.  Using a percentage of the screen height keeps the animation
 * magnitude consistent across compact (SE-sized) and tall (tablet / large-
 * phone) displays.
 *
 * Reference: 1.5 % of 667 px (iPhone SE 2) ≈ 10 px — the original hard-coded
 * value.  The result is clamped to [6, 18] to avoid extremes on very small
 * or very large screens.
 *
 * @param pct   Fraction of screen height to use.  Defaults to 0.015 (1.5 %).
 * @param min   Minimum clamped value in logical pixels.  Defaults to 6.
 * @param max   Maximum clamped value in logical pixels.  Defaults to 18.
 */
export function useBounceOffset(
  pct = 0.015,
  min = 6,
  max = 18,
): number {
  const { height } = useWindowDimensions();
  return Math.round(Math.min(max, Math.max(min, height * pct)));
}
