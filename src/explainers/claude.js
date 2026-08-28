import { IMPORTANCE } from '../events.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
export const DAILY_CALL_CAP = 500;

const SPORT_NAMES = { nfl: 'NFL football', mlb: 'Major League Baseball', f1: 'Formula 1' };

export function buildPrompt(event) {
  const sport = SPORT_NAMES[event.sport] || 'sports';
  const system = [
    `You explain ${sport} to someone who has never watched it before.`,
    'Write one or two short sentences in plain English. No jargon.',
    'Describe only what the play data states. Do not invent details, statistics,',
    'player intent, or consequences that are not present in the input.',
    'Do not speculate about what happens next. Do not use emojis.'
  ].join(' ');

  const lines = [
    `Play type: ${event.type || 'unknown'}`,
    `Description: ${event.text}`
  ];
  if (event.period && event.period.display) lines.push(`Period: ${event.period.display}`);
  if (event.clock) lines.push(`Clock: ${event.clock}`);
  if (event.score) lines.push(`Score: home ${event.score.home}, away ${event.score.away}`);

  return { system, user: lines.join('\n') };
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function createClaudeExplainer({
  getKey, getBudget, setBudget, fetchImpl = fetch, now = () => new Date()
}) {
  return {
    name: 'claude',
    async explain(event) {
      if (!event) return null;
      // Only high importance reaches the API. This gate is what holds cost
      // at roughly 2-3 cents per game.
      if (event.importance !== IMPORTANCE.HIGH) return null;
      // Scraped text has no schema and must never be sent to the model.
      if (event.degraded === true) return null;

      const key = await getKey();
      if (!key) return null;

      const today = dayKey(now());
      const budget = (await getBudget()) || { day: today, count: 0 };
      const count = budget.day === today ? budget.count : 0;
      if (count >= DAILY_CALL_CAP) return null;

      const { system, user } = buildPrompt(event);

      let response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 150,
            system,
            messages: [{ role: 'user', content: user }]
          })
        });
      } catch {
        return null;
      }

      if (!response.ok) return null;

      let json;
      try {
        json = await response.json();
      } catch {
        return null;
      }

      const block = Array.isArray(json.content)
        ? json.content.find(b => b.type === 'text')
        : null;
      if (!block || !block.text) return null;

      await setBudget({ day: today, count: count + 1 });
      return block.text.trim();
    }
  };
}
