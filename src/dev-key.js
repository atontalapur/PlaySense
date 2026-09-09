// Development convenience: seed an Anthropic key from a file in the extension
// directory so a fresh browser profile does not mean pasting it into the popup
// again. A Chrome extension has no build step and no process.env, but it can
// read files packaged alongside it, which is what this does.
//
// The file is `dev.env`, not `.env`. Chrome skips dotfiles when it loads an
// extension directory, so a `.env` would simply never be found.
//
// dev.env is gitignored and package-extension.sh refuses to build if it is
// present in the staged output, so a key cannot reach the Web Store this way.
// It is still a plaintext key on disk inside a directory Chrome loads — fine
// for a machine you control, wrong for a shared one.

export const DEV_ENV_FILE = 'dev.env';
export const KEY_NAME = 'ANTHROPIC_API_KEY';

// Deliberately minimal: KEY=value per line, # for comments, optional matched
// quotes. Not a general .env implementation — no interpolation, no multi-line
// values, no `export` prefix. Anything it does not understand is skipped rather
// than guessed at.
export function parseEnv(text) {
  const out = {};
  if (typeof text !== 'string') return out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    // Strip one layer of matched quotes, so a key pasted with them still works.
    if (value.length >= 2 && (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) out[key] = value;
  }

  return out;
}

// Reads dev.env and returns the key in it, or null. Never throws: the file is
// absent on every normal install, which is not an error.
export async function readDevKey({ fetchImpl, urlFor }) {
  let text;
  try {
    const response = await fetchImpl(urlFor(DEV_ENV_FILE));
    if (!response.ok) return null;
    text = await response.text();
  } catch {
    return null;
  }
  return parseEnv(text)[KEY_NAME] || null;
}

// Seeds the key into storage if, and only if, there is not one there already.
// A key saved through the popup has been verified against the API; this one has
// not, so it must never overwrite it.
export async function seedKeyFromDevEnv({ fetchImpl, urlFor, getStored, setStored }) {
  const existing = await getStored();
  if (existing) return { seeded: false, reason: 'key-already-saved' };

  const key = await readDevKey({ fetchImpl, urlFor });
  if (!key) return { seeded: false, reason: 'no-dev-env' };

  // Marked unverified on purpose: the popup will report it as "saved but never
  // verified", which is true — nothing has asked Anthropic whether it works.
  await setStored(key);
  return { seeded: true, reason: null };
}
