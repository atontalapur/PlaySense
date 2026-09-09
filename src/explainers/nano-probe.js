// Chrome's built-in Prompt API (Gemini Nano) would let PlaySense explain plays
// with a real model and no API key: on-device, no cost, and nothing to disclose
// in the privacy policy because nothing leaves the machine.
//
// Before any of that can be designed there is one fact to establish, and it
// decides the shape of the whole feature: whether `LanguageModel` is exposed to
// an MV3 service worker. PlaySense runs its explainer chain in background.js.
// If the API is only available to extension pages and content scripts, a Nano
// explainer cannot live beside the others and has to run in content.js and be
// reached by message, which is a different design.
//
// The published docs do not settle it, and the search results that discuss it
// are mixed in with the retired origin-trial API (`ai.languageModel`,
// `aiLanguageModelOriginTrial`) that no longer applies. So this probes the real
// browser instead of guessing, and is deliberately a read-only report: it
// creates no session and downloads no model.

// What LanguageModel.availability() can return, per the Prompt API:
//   'unavailable'  - this device or profile cannot run it at all
//   'downloadable' - supported, but the model is not on disk yet
//   'downloading'  - the model is being fetched right now
//   'available'    - ready to use immediately
export const USABLE_STATES = new Set(['available', 'downloading', 'downloadable']);

// `scope` is injected rather than read off globalThis so this can be pointed at
// a service worker's global, a page's window, or a fake in tests.
export async function probeLanguageModel(scope = globalThis) {
  const api = scope ? scope.LanguageModel : undefined;

  if (!api || typeof api.availability !== 'function') {
    return {
      present: false,
      availability: null,
      usable: false,
      reason: api ? 'no-availability-method' : 'not-exposed'
    };
  }

  let availability;
  try {
    availability = await api.availability();
  } catch (error) {
    // Present but unusable is a real outcome, not a bug to swallow — an
    // enterprise policy or an unsupported profile can throw here.
    return {
      present: true,
      availability: null,
      usable: false,
      reason: 'availability-threw',
      message: String((error && error.message) || error)
    };
  }

  // params() carries the sampling limits and is informational only, so a
  // failure here must not turn a usable probe into an unusable one.
  let params = null;
  try {
    params = typeof api.params === 'function' ? await api.params() : null;
  } catch {
    params = null;
  }

  return {
    present: true,
    availability: typeof availability === 'string' ? availability : null,
    usable: USABLE_STATES.has(availability),
    reason: null,
    params
  };
}

// One line a human can read, for the popup. The probe result is a shape; this
// is the sentence that tells you what it means for the feature.
export function describeProbe(where, probe) {
  if (!probe) return `${where}: could not be reached.`;
  if (!probe.present) return `${where}: LanguageModel is not exposed here.`;
  if (probe.reason === 'availability-threw') {
    return `${where}: present, but availability() failed (${probe.message}).`;
  }
  return `${where}: ${probe.availability || 'unknown'}${probe.usable ? '' : ' (not usable)'}.`;
}
