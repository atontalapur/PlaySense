// Both ESPN summary endpoints carry the game clock state at the same path:
// header.competitions[0].status.type.state, one of 'pre' | 'in' | 'post'.
// Spec 4.2 needs it to tell a not-yet-started game's empty play list from a
// broken feed's, and spec 4.3 needs it to stop polling once a game is over.
// Returns null when the shape is missing rather than guessing — callers treat
// an unknown state as "not pre", which is the safe direction for both uses.
export function espnGameState(json) {
  if (!json || typeof json !== 'object') return null;
  const header = json.header;
  if (!header || typeof header !== 'object') return null;
  const competitions = Array.isArray(header.competitions) ? header.competitions : [];
  const competition = competitions[0];
  if (!competition || typeof competition !== 'object') return null;
  const status = competition.status;
  if (!status || typeof status !== 'object') return null;
  const type = status.type;
  if (!type || typeof type !== 'object') return null;
  return typeof type.state === 'string' ? type.state : null;
}
