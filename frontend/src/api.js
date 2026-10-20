let sessionVersion = 0;
export function getSessionVersion() { return sessionVersion; }
export function advanceSessionVersion() { sessionVersion += 1; }

export class ApiError extends Error {
  constructor(message, status, code, details) { super(message); Object.assign(this, { status, code, details }); }
}
export async function api(path, options = {}) {
  const requestVersion = getSessionVersion();
  const authPath = path.replace(/^\/api/, '').split('?')[0];
  const init = { credentials: 'include', ...options, headers: { ...options.headers } };
  if (init.body !== undefined && !(init.body instanceof FormData) && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.body);
  }
  const response = await fetch(path.startsWith('/api') ? path : `/api${path}`, init);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const result = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    // A delayed response from the previous account must not clear the current session.
    if (response.status === 401 && !authPath.startsWith('/auth/') && requestVersion === getSessionVersion()) {
      window.dispatchEvent(new Event('self-fit-session-expired'));
    }
    throw new ApiError(result?.error?.message || '요청을 처리하지 못했어요.', response.status, result?.error?.code, result?.error?.details);
  }
  if (['/auth/login', '/auth/logout', '/auth/change-password'].includes(authPath)) advanceSessionVersion();
  return result;
}
