import { useEffect, useRef, useState } from "react";

/**
 * Text-input state that is mirrored to the URL without losing keystrokes.
 *
 * Why: the router applies `setSearchParams` asynchronously (as a transition), so an
 * input whose `value` comes straight from the URL is re-rendered with the previous URL
 * value between keystrokes and fast typing drops characters. Found in Task 09 QA:
 * "loss" became "lss" in Firefox, and "nan-loss-fp16" became "nan-los-fp6" in Chrome
 * under CPU throttling (also 1 in 5 unthrottled).
 *
 * The input renders local state, updated synchronously on every change. URL values
 * that echo what this hook sent are ignored while the URL catches up. Any other URL
 * value (Clear filters, Back, a link to `/`) is adopted, so the URL stays the source
 * of truth for changes made elsewhere.
 */
export function useUrlBackedText(
  urlValue: string,
  commit: (value: string) => void,
): readonly [string, (value: string) => void] {
  const [text, setText] = useState(urlValue);
  const textRef = useRef(text);
  /** Values sent to the URL that it has not caught up with yet, oldest first. */
  const pending = useRef<string[]>([]);

  useEffect(() => {
    if (urlValue === textRef.current) {
      pending.current = []; // in sync
      return;
    }
    const echo = pending.current.indexOf(urlValue);
    if (echo >= 0) {
      pending.current.splice(0, echo + 1); // a lagging echo of our own typing
      return;
    }
    pending.current = []; // changed elsewhere: the URL wins
    textRef.current = urlValue;
    setText(urlValue);
  }, [urlValue]);

  const change = (value: string) => {
    textRef.current = value;
    pending.current.push(value);
    setText(value);
    commit(value);
  };
  return [text, change] as const;
}
