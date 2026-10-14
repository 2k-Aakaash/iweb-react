import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  convert,
  parseConversionQuery,
  setCurrencyPrefs,
  CurrencyError
} from '../../libs/currency/currencyService';

const DEBOUNCE_MS = 150;
const FEEDBACK_MS = 1600;

// Same precision rules as formatMoney, as a plain clipboard-friendly number ("8342.50").
function plainAmount(value) {
  const abs = Math.abs(value);
  const digits = abs >= 1 || abs === 0 ? 2 : abs >= 0.01 ? 4 : 6;
  return value.toFixed(digits);
}

function friendlyError(err) {
  if (err instanceof CurrencyError) return err.message;
  return 'Couldn’t convert right now. Try again in a moment.';
}

/**
 * Spotlight instant answer for currency queries ("100 usd to inr").
 * Returns null for anything that isn't a conversion, so other queries never render it.
 */
export function useCurrencyAnswer(query) {
  const conversion = useMemo(() => parseConversionQuery(query), [query]);
  const key = conversion ? `${conversion.amount}|${conversion.from}|${conversion.to}` : null;

  // { key, data, error, receivedAt } for the last settled request.
  const [answer, setAnswer] = useState(null);
  // { key, kind: 'copied' | 'copy-failed' | 'saved' } shown briefly inside the card.
  const [feedback, setFeedback] = useState(null);
  const requestSeq = useRef(0);
  const feedbackTimer = useRef(null);

  useEffect(() => {
    if (!key) return undefined;

    const seq = ++requestSeq.current;
    const controller = new AbortController();
    const [amountText, from, to] = key.split('|');

    const timer = setTimeout(() => {
      convert(Number(amountText), from, to, { signal: controller.signal })
        .then((data) => {
          if (seq !== requestSeq.current) return;
          setAnswer({ key, data, error: null, receivedAt: Date.now() });
        })
        .catch((err) => {
          if (seq !== requestSeq.current || err?.name === 'AbortError') return;
          setAnswer({ key, data: null, error: friendlyError(err), receivedAt: Date.now() });
        });
    }, DEBOUNCE_MS);

    return () => {
      requestSeq.current += 1; // anything still in flight for this key is now stale
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  // Confirmation belongs to the conversion it was shown for.
  useEffect(() => () => {
    clearTimeout(feedbackTimer.current);
    setFeedback(null);
  }, [key]);

  const flash = useCallback((kind) => {
    clearTimeout(feedbackTimer.current);
    setFeedback({ key, kind });
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, [key]);

  const current = answer && answer.key === key ? answer : null;
  const data = current?.data || null;

  const copy = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(`${plainAmount(data.result)} ${data.to}`);
      flash('copied');
    } catch {
      flash('copy-failed');
    }
  }, [data, flash]);

  const saveToWidget = useCallback(() => {
    if (!conversion) return;
    setCurrencyPrefs({ amount: conversion.amount, from: conversion.from, to: conversion.to });
    flash('saved');
  }, [conversion, flash]);

  if (!conversion) return null;

  return {
    conversion,
    status: current ? (current.error ? 'error' : 'ready') : 'loading',
    data,
    error: current?.error || null,
    receivedAt: current?.receivedAt || null,
    feedback: feedback && feedback.key === key ? feedback.kind : null,
    copy,
    saveToWidget
  };
}
