import { fail } from './errors.js';
import { loadChallenge, resolveCurrentChallenge } from './challenges.js';

// readOnly: an archived challenge stays readable by its active members (reads only; writes get CHALLENGE_ARCHIVED).
export async function studentContext(db,user,challengeId,{allowEmpty=false,lock=false,readOnly=false}={}) {
  if(lock && challengeId) {
    await db.$queryRaw`SELECT id FROM "Challenge" WHERE id = ${challengeId} FOR SHARE`;
    await db.$queryRaw`SELECT id FROM "ChallengeMembership" WHERE "challengeId" = ${challengeId} AND "userId" = ${user.id} FOR SHARE`;
  }
  const challenge=challengeId ? await loadChallenge(db,challengeId) : await resolveCurrentChallenge(db,user);
  if(challenge && !['published','archived'].includes(challenge.lifecycle)) fail(404,'CHALLENGE_NOT_FOUND','챌린지를 찾을 수 없어요.');
  const membership=challenge ? await db.challengeMembership.findUnique({where:{challengeId_userId:{challengeId:challenge.id,userId:user.id}}}) : null;
  if(challenge?.lifecycle==='archived' && membership?.status!=='active') fail(404,'CHALLENGE_NOT_FOUND','챌린지를 찾을 수 없어요.');
  if(!challenge || membership?.status!=='active') {
    if(allowEmpty && !challengeId) return {challenge:null,membership:null};
    fail(403,'NOT_MEMBER','참여 중인 챌린지에서만 기록을 확인할 수 있어요.');
  }
  if(challenge.lifecycle==='archived' && !readOnly) fail(409,'CHALLENGE_ARCHIVED','보관된 챌린지의 기록은 볼 수만 있어요.');
  return {challenge,membership};
}
export async function teacherChallenge(db,req) {
  const challenge=await resolveCurrentChallenge(db,req.user,req.query.challengeId);
  if(!challenge) fail(404,'CHALLENGE_NOT_FOUND','현재 챌린지를 찾을 수 없어요.');
  return challenge;
}
