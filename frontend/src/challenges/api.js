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

const query = filters => {
  const params = new URLSearchParams(Object.entries(filters || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined && !(Array.isArray(value) && !value.length)).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]));
  return params.size ? `?${params}` : '';
};
export const listMembers = (id, filters = {}) => api(`${path(id)}/members${query(filters)}`);
export const previewMembers = (id, selection) => api(`${path(id)}/members/preview`, { method: 'POST', body: selection });
export const addMembers = (id, body) => api(`${path(id)}/members`, { method: 'POST', body });
export const removeMember = (id, userId) => api(`${path(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
/** Roster for the member picker. Existing endpoint, not challenge-scoped (contract: /teacher/students). */
export const listStudents = () => api('/teacher/students');

const mine = id => `/student/challenges/${encodeURIComponent(id)}`;
export const listMyChallenges = () => api('/student/challenges');
export const acceptInvitation = id => api(`${mine(id)}/accept`, { method: 'POST', body: {} });
export const declineInvitation = id => api(`${mine(id)}/decline`, { method: 'POST', body: {} });
export const getStudentChallenge = id => api(mine(id));
export const getChallengeDashboard = id => api(`${mine(id)}/dashboard`);
