// Screens import the challenge API from here only. VITE_CHALLENGE_API=mock swaps in the
// in-memory mock; the flag is replaced at build time, so production bundles never include it.
export const usingMock = import.meta.env.VITE_CHALLENGE_API === 'mock';
const client = () => usingMock ? import('./api.mock.js') : import('./api.js');
const call = name => async (...args) => (await client())[name](...args);
// Screens that only read challenges (the teacher's challenge selector) reload when one changes.
export const CHALLENGES_CHANGED = 'self-fit:challenges-changed';
const change = name => async (...args) => {
  const result = await call(name)(...args);
  window.dispatchEvent(new Event(CHALLENGES_CHANGED));
  return result;
};

export const listChallenges = call('listChallenges');
export const createChallenge = change('createChallenge');
export const duplicateChallenge = change('duplicateChallenge');
export const getChallenge = call('getChallenge');
export const updateChallenge = change('updateChallenge');
export const publishChallenge = change('publishChallenge');
export const archiveChallenge = change('archiveChallenge');
export const deleteChallenge = change('deleteChallenge');

export const listMembers = call('listMembers');
export const previewMembers = call('previewMembers');
export const addMembers = change('addMembers');
export const removeMember = change('removeMember');
export const listStudents = call('listStudents');

export const listMyChallenges = call('listMyChallenges');
export const acceptInvitation = call('acceptInvitation');
export const declineInvitation = call('declineInvitation');
export const getStudentChallenge = call('getStudentChallenge');
export const getChallengeDashboard = call('getChallengeDashboard');
