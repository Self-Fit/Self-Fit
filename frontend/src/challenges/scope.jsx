import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { Icon, navigate, useLocation } from '../shared.jsx';
import { getChallenge, listChallenges } from './index.js';
import { useLoad } from './ui.jsx';
import { programOf } from './program.js';

// Which challenge the teacher's overview, participation, corrections, student detail, export and
// schedule screens show. URL `?challengeId=` wins, then the last choice, then the server's "current"
// challenge (published, latest startDate — the list is sorted that way, README §5).
const KEY = 'self-fit.teacher.challengeId';
const read = () => { try { return window.localStorage.getItem(KEY); } catch { return null; } };
const write = id => { try { if (id) window.localStorage.setItem(KEY, id); else window.localStorage.removeItem(KEY); } catch { /* storage may be blocked */ } };
const Scope = createContext(null);

export function TeacherChallengeProvider({ scoped, children }) {
  const location = useLocation();
  const [pathname, search = ''] = location.split('?');
  const fromUrl = new URLSearchParams(search).get('challengeId');
  const list = useLoad(() => listChallenges({ lifecycle: 'all' }), []);
  const options = useMemo(() => (list.data?.challenges || []).filter(challenge => challenge.lifecycle !== 'draft'), [list.data]);
  const current = options.find(challenge => challenge.lifecycle === 'published') || null;
  const requested = fromUrl || read();
  const selectedId = requested && options.some(challenge => challenge.id === requested) ? requested : null;
  const id = selectedId || current?.id || null;
  const detail = useLoad(() => (id ? getChallenge(id) : Promise.resolve(null)), [id]);
  const challenge = detail.data?.challenge?.id === id ? detail.data.challenge : null;

  const withChallenge = useCallback((path, nextId) => {
    const [base, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    if (nextId) params.set('challengeId', nextId); else params.delete('challengeId');
    return params.size ? `${base}?${params}` : base;
  }, []);
  const select = useCallback(nextId => { write(nextId); navigate(withChallenge(location, nextId)); }, [location, withChallenge]);

  useEffect(() => {
    if (!list.data) return;
    if (fromUrl && selectedId) write(fromUrl);
    else if (requested && !selectedId) write(null); // deleted, draft or unknown: fall back to the current challenge
    // Keep the choice visible in the address of scoped screens so it can be shared and reloaded.
    if (scoped && selectedId && !fromUrl) navigate(withChallenge(location, selectedId), true);
  }, [list.data, fromUrl, selectedId, requested, scoped, location, withChallenge]);

  const ready = !!list.data && (!id || !!challenge);
  const value = {
    options, current, selectedId, id, challenge, program: programOf(challenge), select, withChallenge, pathname,
    ready, error: list.error || (id ? detail.error : null),
    refresh: () => { list.refresh(); detail.refresh(); },
    query: id ? `challengeId=${encodeURIComponent(id)}` : '',
  };
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}

export const useTeacherChallenge = () => useContext(Scope);

/** Header control: "현재" follows the server's current challenge; other entries pin one. */
export function ChallengeSelector({ mode }) {
  const scope = useTeacherChallenge();
  if (!scope?.options.length) return null;
  return <label className={`ch-scope ${mode === 'mobile' ? 'is-mobile' : ''}`}>
    <Icon name="flag" size={16} />
    <span className="sr-only">보고 있는 챌린지</span>
    <select value={scope.selectedId || ''} onChange={event => scope.select(event.target.value || null)}>
      <option value="">{`현재 챌린지 · ${scope.current?.title || '없음'}`}</option>
      {scope.options.map(challenge => <option key={challenge.id} value={challenge.id}>{challenge.title}{challenge.lifecycle === 'archived' ? ' (보관됨)' : ''}</option>)}
    </select>
    <Icon name="chevron" size={14} className="ch-scope-chev" />
  </label>;
}
