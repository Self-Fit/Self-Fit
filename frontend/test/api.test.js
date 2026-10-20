import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function setup(t, fetch) {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  let expirations = 0;
  window.addEventListener('self-fit-session-expired', () => { expirations += 1; });
  t.after(() => { globalThis.window = previous; });
  t.mock.method(globalThis, 'fetch', fetch);
  return () => expirations;
}

test('a previous account response cannot expire a newer login', async t => {
  const oldResponse = deferred();
  const expirations = setup(t, path => path === '/api/auth/login'
    ? Promise.resolve(json({ user: { id: 'B' } })) : oldResponse.promise);
  const oldRequest = api('/student/dashboard').catch(error => error);
  await api('/auth/login', { method: 'POST', body: { loginId: 'B', password: 'example' } });
  oldResponse.resolve(json({ error: { message: 'expired' } }, 401));
  assert.equal((await oldRequest).status, 401);
  assert.equal(expirations(), 0);
});

test('a response whose body arrives after account change cannot expire the new account', async t => {
  const body = deferred();
  const expirations = setup(t, path => path === '/api/auth/login'
    ? Promise.resolve(json({ user: { id: 'B' } }))
    : Promise.resolve({ ok: false, status: 401, headers: new Headers({ 'content-type': 'application/json' }), json: () => body.promise }));
  const oldRequest = api('/student/records').catch(error => error);
  await api('/api/auth/login', { method: 'POST', body: {} });
  body.resolve({ error: { message: 'expired' } });
  assert.equal((await oldRequest).status, 401);
  assert.equal(expirations(), 0);
});

test('a current protected response still expires the session and preserves error details', async t => {
  const expirations = setup(t, () => Promise.resolve(json({ error: { message: 'expired', code: 'UNAUTHORIZED', details: { reason: 'session' } } }, 401)));
  await assert.rejects(api('/student/dashboard'), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'UNAUTHORIZED');
    assert.deepEqual(error.details, { reason: 'session' });
    return true;
  });
  assert.equal(expirations(), 1);
});

test('a failed login does not hide an actual current-session expiration', async t => {
  const response = deferred();
  const expirations = setup(t, path => path === '/api/auth/login'
    ? Promise.resolve(json({ error: { message: 'incorrect password' } }, 401)) : response.promise);
  const currentRequest = api('/student/dashboard').catch(error => error);
  await assert.rejects(api('/auth/login', { method: 'POST', body: {} }), { status: 401 });
  assert.equal(expirations(), 0);
  response.resolve(json({ error: { message: 'expired' } }, 401));
  await currentRequest;
  assert.equal(expirations(), 1);
});

test('successful logout invalidates pending protected responses', async t => {
  const response = deferred();
  const expirations = setup(t, path => path === '/api/auth/logout'
    ? Promise.resolve(json({ ok: true })) : response.promise);
  const pending = api('/student/dashboard').catch(error => error);
  await api('/auth/logout', { method: 'POST', body: {} });
  response.resolve(json({ error: { message: 'expired' } }, 401));
  await pending;
  assert.equal(expirations(), 0);
});
