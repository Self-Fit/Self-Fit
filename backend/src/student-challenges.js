import { Router } from 'express';
import { fail } from './errors.js';
import { koreanDate } from './domain/index.js';
import { challengeCounts, challengeDto, loadChallenge, resolveCurrentChallenge } from './challenges.js';
import { acceptInvitation, declineInvitation, membershipSelf } from './memberships.js';
import { studentRecordRouter } from './student.js';

export async function studentChallengeList(db,user) {
  return db.$transaction(async tx=>{
    const today=koreanDate();
    const memberships=await tx.challengeMembership.findMany({
      where:{userId:user.id,status:{in:['active','pending']},challenge:{lifecycle:{in:['published','archived']}}},
      include:{challenge:{include:{weeks:{orderBy:{week:'asc'}}}}},
      orderBy:[{challenge:{startDate:'desc'}},{challengeId:'asc'}],
    });
    const counts=await challengeCounts(tx,memberships.map(member=>member.challengeId));
    const item=member=>({challenge:challengeDto({...member.challenge,counts:counts.get(member.challengeId)},today,{detail:false}),membership:membershipSelf(member)});
    // Archived challenges are listed apart (read-only history); everything else is about published ones.
    const archived=memberships.filter(member=>member.challenge.lifecycle==='archived'&&member.status==='active');
    const live=memberships.filter(member=>member.challenge.lifecycle==='published');
    const active=live.filter(member=>member.status==='active');
    const current=await resolveCurrentChallenge(tx,user);
    return {
      current:current?item(active.find(member=>member.challengeId===current.id)):null,
      challenges:active.map(item),
      archived:archived.map(item),
      invitations:live.filter(member=>member.mode==='invited'&&member.status==='pending'&&today<=member.challenge.enrollmentDeadline).map(item),
      // Pending invitations past their deadline, kept until the challenge ends so the student sees why they cannot join.
      closedInvitations:live.filter(member=>member.mode==='invited'&&member.status==='pending'&&today>member.challenge.enrollmentDeadline&&today<=member.challenge.endDate).map(item),
    };
  },{isolationLevel:'RepeatableRead'});
}

export function studentChallengeRouter(db) {
  const router=Router();
  router.get('/',async(req,res)=>res.json(await studentChallengeList(db,req.user)));
  router.post('/:challengeId/accept',async(req,res)=>res.json({membership:await acceptInvitation(db,req.params.challengeId,req.user.id)}));
  router.post('/:challengeId/decline',async(req,res)=>res.json({membership:await declineInvitation(db,req.params.challengeId,req.user.id)}));
  router.get('/:challengeId',async(req,res)=>{
    const challenge=await loadChallenge(db,req.params.challengeId);
    const member=challenge.lifecycle==='archived'?await db.challengeMembership.findUnique({where:{challengeId_userId:{challengeId:challenge.id,userId:req.user.id}}}):null;
    // Published details are public to students (invitation cards); archived ones only to their active members.
    if(!(challenge.lifecycle==='published'||member?.status==='active')) fail(404,'CHALLENGE_NOT_FOUND','챌린지를 찾을 수 없어요.');
    res.json({challenge:challengeDto(challenge)});
  });
  router.use('/:challengeId',studentRecordRouter(db));
  return router;
}
