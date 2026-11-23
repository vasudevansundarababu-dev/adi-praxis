/**
 * D-020 (owner, 23 Nov 2026): when an AI feature's provider fails, people saw raw provider text such as
 * `{"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}`. This turns the cause into a plain
 * sentence and always says that manual work is still available. The raw error stays in the server log only.
 */
export type AiFailure = 'signin_expired' | 'quota' | 'timeout' | 'other';

const textOf = (err: unknown): string => {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (e instanceof Error) {
      parts.push(e.name, e.message);
      e = (e as { cause?: unknown }).cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  return parts.join(' ');
};

/** Which kind of provider failure this is, from the error and its causes. */
export function aiFailureKind(err: unknown): AiFailure {
  const t = textOf(err);
  if (/invalid_grant|invalid_rapt|reauth|Could not load the default credentials|default credentials|invalid_client|UNAUTHENTICATED|refresh token|\((401|403)\)/i.test(t)) return 'signin_expired';
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit|\(429\)|budget/i.test(t)) return 'quota';
  if (/timed out|timeout|TimeoutError|AbortError/i.test(t)) return 'timeout';
  return 'other';
}

/**
 * The message a person sees. `feature` names the assistant ("Help", "The policy assistant"); `manual` says what they
 * can do by hand; `fallback` is the feature's own message for any other failure.
 */
export function aiUnavailableMessage(err: unknown, feature: string, manual: string, fallback: string): string {
  switch (aiFailureKind(err)) {
    case 'signin_expired':
      return `${feature} can’t reach the AI service: the Google sign-in for AI on this computer has expired. Ask an admin to sign in again. ${manual}`;
    case 'quota':
      return `${feature} is busy or over its AI usage limit. Try again in a few minutes. ${manual}`;
    case 'timeout':
      return `${feature} took too long to answer. Try again. ${manual}`;
    default:
      return fallback;
  }
}

/** For the server log: the error's name and message (provider errors carry no secrets), shortened. */
export const aiErrorForLog = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
