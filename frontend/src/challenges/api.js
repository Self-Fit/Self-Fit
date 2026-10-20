// Real challenge client: one function per endpoint in docs/challenges/api-contract.md.
// Each returns the response body unchanged (e.g. {challenges}, {challenge}, {ok}).
import { api } from '../shared.jsx';

const path = id => `/teacher/challenges/${encodeURIComponent(id)}`;

export const listChallenges = ({ lifecycle = 'all' } = {}) => api(`/teacher/challenges?${new URLSearchParams({ lifecycle })}`);
export const createChallenge = body => api('/teacher/challenges', { method: 'POST', body });
export const duplicateChallenge = (id, { title, startDate } = {}) => api(`${path(id)}/duplicate`, { method: 'POST', body: { ...(title ? { title } : {}), startDate } });
export const getChallenge = id => api(path(id));
export const updateChallenge = (id, body) => api(path(id), { method: 'PATCH', body });
export const publishChallenge = id => api(`${path(id)}/publish`, { method: 'POST', body: {} });
export const archiveChallenge = id => api(`${path(id)}/archive`, { method: 'POST', body: {} });
export const deleteChallenge = id => api(path(id), { method: 'DELETE' });
