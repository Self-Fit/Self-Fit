// Screens import the challenge API from here only. VITE_CHALLENGE_API=mock swaps in the
// in-memory mock; the flag is replaced at build time, so production bundles never include it.
export const usingMock = import.meta.env.VITE_CHALLENGE_API === 'mock';
const client = () => usingMock ? import('./api.mock.js') : import('./api.js');
const call = name => async (...args) => (await client())[name](...args);

export const listChallenges = call('listChallenges');
export const createChallenge = call('createChallenge');
export const duplicateChallenge = call('duplicateChallenge');
export const getChallenge = call('getChallenge');
export const updateChallenge = call('updateChallenge');
export const publishChallenge = call('publishChallenge');
export const archiveChallenge = call('archiveChallenge');
export const deleteChallenge = call('deleteChallenge');

export const listMembers = call('listMembers');
export const previewMembers = call('previewMembers');
export const addMembers = call('addMembers');
export const removeMember = call('removeMember');
export const listStudents = call('listStudents');

export const listMyChallenges = call('listMyChallenges');
export const acceptInvitation = call('acceptInvitation');
export const declineInvitation = call('declineInvitation');
export const getStudentChallenge = call('getStudentChallenge');
export const getChallengeDashboard = call('getChallengeDashboard');
