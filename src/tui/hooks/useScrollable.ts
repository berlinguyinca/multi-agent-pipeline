import { useState, useCallback } from 'react';

export interface ScrollableState {
  offset: number;
  scrollUp: () => void;
  scrollDown: () => void;
  pageUp: () => void;
  pageDown: () => void;
  scrollToBottom: () => void;
}

export function useScrollable(totalLines: number, viewportHeight: number): ScrollableState {
  const maxOffset = Math.max(0, totalLines - viewportHeight);
  const [offset, setOffset] = useState(0);

  const clamp = useCallback(
    (value: number) => Math.min(maxOffset, Math.max(0, value)),
    [maxOffset]
  );

  const scrollUp = useCallback(() => {
    setOffset((prev) => clamp(prev - 1));
  }, [clamp]);

  const scrollDown = useCallback(() => {
    setOffset((prev) => clamp(prev + 1));
  }, [clamp]);

  const pageUp = useCallback(() => {
    setOffset((prev) => clamp(prev - viewportHeight));
  }, [clamp, viewportHeight]);

  const pageDown = useCallback(() => {
    setOffset((prev) => clamp(prev + viewportHeight));
  }, [clamp, viewportHeight]);

  const scrollToBottom = useCallback(() => {
    setOffset(maxOffset);
  }, [maxOffset]);

  return { offset, scrollUp, scrollDown, pageUp, pageDown, scrollToBottom };
}
