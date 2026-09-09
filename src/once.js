// Ensures a factory runs at most once per key while a call for that key is
// in flight. Concurrent callers for the same key are handed the SAME
// settling promise instead of each starting their own construction — used
// by background.js to fix a check-then-act race in ensureSession, where two
// messages for the same tab arriving before the first session finished
// constructing would each build (and pump) their own session, doubling
// emitted events and, later, billed LLM calls.
//
// `inFlight` is a Map the caller owns and can reuse across calls; this
// module does not create or hold any state itself. Once the factory's
// promise settles (resolve or reject) the key is removed, so the next call
// for that key constructs again.
export function once(inFlight, key, factory) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = Promise.resolve().then(factory);
  inFlight.set(key, promise);

  // Cleanup runs on a separate chain so a rejection from `factory` is not
  // swallowed here — it must still reach whoever awaits the returned
  // promise. The `.catch(() => {})` only suppresses the cleanup chain's own
  // unhandled-rejection warning, not the original promise's rejection.
  promise
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    })
    .catch(() => {});

  return promise;
}
