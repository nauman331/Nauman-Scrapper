import { randomBytes } from 'node:crypto';

const sessions = new Map<string, { conversionId: string; expiresAt: number }>();
const SESSION_TTL_MS = 60 * 60 * 1000;

export function createHtmlPreviewSession(conversionId: string): string {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { conversionId, expiresAt: now + SESSION_TTL_MS });
  return token;
}

export function getHtmlPreviewConversion(token: string): string | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.conversionId;
}
