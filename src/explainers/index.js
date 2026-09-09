export { RuleExplainer } from './rules.js';
export { createClaudeExplainer, createDailyBudget, validateKey, DAILY_CALL_CAP } from './claude.js';

// Tries each provider in order; the first non-null answer wins. A provider
// that throws is skipped, so the AI tier can never make the extension worse
// than the rules tier alone.
export function createExplainerChain(providers) {
  return {
    async explain(event) {
      for (const provider of providers) {
        try {
          const result = await provider.explain(event);
          if (result) return result;
        } catch {
          // fall through to the next provider
        }
      }
      return null;
    }
  };
}
