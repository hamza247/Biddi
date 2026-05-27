import { useCallback, useEffect, useRef, useState } from "react";

interface CountdownState {
  secondsLeft: number;
  progress: number;
}

/**
 * Counts down from `totalSeconds`.
 * Does nothing until `active` is true.
 * Calls `onExpire` once when it reaches zero.
 */
export function useCountdown(
  totalSeconds: number,
  onExpire: () => void,
  active: boolean
): CountdownState {
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const reset = useCallback(() => {
    setSecondsLeft(totalSeconds);
  }, [totalSeconds]);

  useEffect(() => {
    reset();
  }, [active, reset]);

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onExpireRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [active]);

  return {
    secondsLeft,
    progress: secondsLeft / totalSeconds,
  };
}
