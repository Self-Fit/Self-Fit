import webpush from 'web-push';
import { koreanDate, reminderDecision, getWeekForDate, challengePhase } from './domain/index.js';
let pushConfigured=false;
export function configurePush() {
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  pushConfigured=true;return true;
}
export async function createReminderEvents(db,instant=new Date()) {
  // The explicit instant is a test seam, never a runtime date override.
  const date=koreanDate(instant);
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(instant));
  if(hour<20) return {created:0};
  const challenges=await db.challenge.findMany({where:{lifecycle:'published',startDate:{lte:date},endDate:{gte:date}},include:{weeks:{orderBy:{week:'asc'}}}});
  let created=0;
  for(const challenge of challenges) {
    if(challengePhase(challenge,date)!=='active') continue;
    const members=await db.challengeMembership.findMany({where:{challengeId:challenge.id,status:'active',user:{role:'student'}},include:{user:{include:{records:{where:{challengeId:challenge.id}}}}}});
    for(const member of members) {
      const user={...member.user,participating:true},decision=reminderDecision(challenge.weeks,user,user.records,date);
      if(!decision.send) continue;
      const remaining=decision.remaining;
      const body=decision.reason==='missing'?'오늘 운동 기록을 남겨 주세요.':typeof remaining==='number'?`이번 주 목표까지 ${remaining}${getWeekForDate(challenge.weeks,date)?.unit || ''} 남았어요. 오늘 기록을 확인해 주세요.`:'오늘 목표와 운동 기록을 확인해 주세요.';
      try {await db.notification.create({data:{userId:user.id,eventKey:`reminder:${challenge.id}:${user.id}:${date}`,type:'reminder',title:'오늘의 Self Fit',body}});created++;}
      catch(error) {if(error.code!=='P2002') throw error;}
    }
  }
  return {created};
}
async function reminderMayBeDelivered(db,event) {
  if(event.type!=='reminder') return true;
  const instant=new Date(),date=koreanDate(instant);
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(instant));
  if(hour<20) return false;
  const suffix=`:${event.userId}:${date}`;
  if(!event.eventKey.startsWith('reminder:')||!event.eventKey.endsWith(suffix)) return false;
  const challengeId=event.eventKey.slice('reminder:'.length,-suffix.length);
  if(!challengeId) return false; // Old keys remain history; never deliver them again.
  const challenge=await db.challenge.findUnique({where:{id:challengeId},include:{weeks:{orderBy:{week:'asc'}}}});
  if(!challenge||challengePhase(challenge,date)!=='active') return false;
  const member=await db.challengeMembership.findUnique({where:{challengeId_userId:{challengeId,userId:event.userId}},include:{user:{include:{records:{where:{challengeId}}}}}});
  return Boolean(member?.status==='active' && reminderDecision(challenge.weeks,{...member.user,participating:true},member.user.records,date).send);
}
// The optional transport is a dependency seam for isolated tests, not a runtime
// setting or HTTP API. Production always uses the configured web-push provider.
export async function deliverPendingPush(db,transport=pushConfigured?((...args)=>webpush.sendNotification(...args)):null) {
  if(!transport) return {delivered:0,cancelled:0};
  const now=new Date();
  const events=await db.notification.findMany({where:{pushState:{in:['pending','retry','sending']},nextTryAt:{lte:now},attempts:{lt:5}},include:{user:{include:{subscriptions:true}}},orderBy:{createdAt:'asc'},take:100});
  let delivered=0,cancelled=0;
  for(const event of events) {
    const claim=await db.notification.updateMany({where:{id:event.id,pushState:event.pushState,nextTryAt:{lte:now},attempts:event.attempts},data:{pushState:'sending',nextTryAt:new Date(Date.now()+5*60*1000),attempts:{increment:1}}});
    if(!claim.count) continue;
    // A reminder can have become obsolete while awaiting transport/retry.
    // Its in-app history remains; only the pending push is cancelled.
    if(!await reminderMayBeDelivered(db,event)) {
      await db.notification.updateMany({where:{id:event.id},data:{pushState:'cancelled'}});cancelled++;continue;
    }
    let transientFailure=false;
    let becameIneligible=false;
    const deliveredEndpoints=new Set(event.deliveredEndpoints || []);
    for(const subscription of event.user.subscriptions) {
      if(deliveredEndpoints.has(subscription.endpoint)) continue;
      // Recheck immediately before every device send, including after a slow
      // send to another device. Correction-result events bypass this gate.
      if(!await reminderMayBeDelivered(db,event)) {becameIneligible=true;break;}
      try {
        await transport({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify({id:event.id,title:event.title,body:event.body,tag:event.id,data:event.data || null,url:event.data?.challengeId?'/mobile/challenges':'/mobile/notifications'}),{TTL:24*60*60,timeout:15_000});
        deliveredEndpoints.add(subscription.endpoint);
        await db.notification.update({where:{id:event.id},data:{deliveredEndpoints:[...deliveredEndpoints]}});
      } catch(error) {
        if([404,410].includes(error.statusCode)) await db.pushSubscription.deleteMany({where:{id:subscription.id}});
        else transientFailure=true;
      }
    }
    if(becameIneligible) {await db.notification.updateMany({where:{id:event.id},data:{pushState:'cancelled'}});cancelled++;continue;}
    const exhausted=event.attempts+1>=5;
    await db.notification.update({where:{id:event.id},data:{pushState:transientFailure?(exhausted?'failed':'retry'):event.user.subscriptions.length?'sent':'no_subscription',nextTryAt:new Date(Date.now()+Math.min(60,event.attempts*5+1)*60*1000)}});
    if(!transientFailure) delivered++;
  }
  return {delivered,cancelled};
}
export function startScheduler(db) {
  let running=false;
  const tick=async()=>{
    if(running) return;
    running=true;
    try {await createReminderEvents(db);await deliverPendingPush(db);await db.session.deleteMany({where:{expiresAt:{lt:new Date()}}});}
    catch(error) {console.error(JSON.stringify({event:'notification_scheduler_failed',code:error.code || error.name}));}
    finally {running=false;}
  };
  const interval=setInterval(tick,60_000);interval.unref();void tick();
  return ()=>clearInterval(interval);
}
