import React,{useCallback,useMemo} from 'react';
import { Icon, Modal, navigate, DesignTemplate, useResource } from './shared';
import { dateText, dateRange, dayIndex, weekdays, formatNumber, recordOf, summaryOf, weekLabel, valueLabel, dailyAchieved } from './student-utils';

/** GET /student/corrections is account-wide; keep the current challenge's requests only. */
export function useChallengeCorrections(revision,challengeId,enabled=true){
  const resource=useResource(enabled?'/student/corrections':null,revision);
  const data=useMemo(()=>resource.data&&{...resource.data,corrections:(resource.data.corrections||[]).filter(item=>!challengeId||!item.challengeId||item.challengeId===challengeId)},[resource.data,challengeId]);
  return {...resource,data};
}
export function StudentPage({mode,title,subtitle,children,wide=false}) { return mode==='web'?<main className={`w-main ${wide?'wide':''}`}>{title&&<div className="w-title"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div></div>}<div className={title?'mt24':''}>{children}</div></main>:<div className="scroll"><div className="page">{title&&<><div className="page-title">{title}</div>{subtitle&&<div className="page-sub">{subtitle}</div>}</>}<div className={title?'mt20':''}>{children}</div></div></div>; }
export function WeekDays({week,records=[],today,mode,onDate}) {
  return <div className="days">{dateRange(week.startDate,week.endDate).map(date=>{const record=recordOf(records,date);const weekend=[0,6].includes(dayIndex(date));const achieved=record&&dailyAchieved(week,record.value);let status=date>today?'future':record?achieved?'done':'miss':'none';if(date===today)status='today';return <div className={`day ${weekend?'we-l':''}`} key={date}><button className={`c ${status} ${weekend?'we':''}`} onClick={()=>onDate?onDate(date):navigate(`/${mode}/records/${date}`)} aria-label={`${dateText(date,true)}, ${record?valueLabel(week,record.value):date>today?'예정':'미입력'}`}>{Number(date.slice(-2))}</button>{weekdays[dayIndex(date)]}</div>;})}</div>;
}
export function WeekSummary({week,summary={},records=[],today,mode,onDate}) {
  return <div className="card pad"><div className="row"><div className="q grow">{week.week}주차 · {week.title}</div><span className="fs13 muted fw6">{dateText(week.startDate)} – {dateText(week.endDate)}</span></div><div className="fs13 t2 mt4">{week.description}</div>{week.deferred?<div className="banner warn mt16"><Icon name="info"/>세부 운동과 완료 조건을 확인 중이에요.</div>:<><WeekDays {...{week,records,today,mode,onDate}}/><div className="divider mt20"/><div className="row mt16 fs14"><span className="grow t2">이번 주</span><b className="num-font">{formatNumber(summary.total)} / {formatNumber(week.weeklyTarget)}{week.unit}</b></div><div className="bar mt8"><i style={{width:`${Math.min(100,(summary.progress||0)*100)}%`}}/></div><div className="legend"><span><i style={{background:'var(--g)'}}/>평일 {formatNumber(summary.weekdayTotal)}{week.unit}</span><span><i style={{background:'#86D6B2'}}/>주말 {formatNumber(summary.weekendTotal)}{week.unit}</span>{summary.complete&&<span className="gtext">주간 완료</span>}</div></>}</div>;
}
export function WeekModal({week,summary={},records,today,mode,onClose,challengeId}) {
  const corrections=useChallengeCorrections(undefined,challengeId,mode==='mobile');
  const setup=useCallback(root=>{
    const text=(selector,content)=>{const e=root.querySelector(selector);if(e)e.textContent=content;};
    text('.m-hd .t',`${week.week}주차 · ${week.title}`);
    const back=root.querySelector('.m-hd .icon-btn');if(back)back.onclick=onClose;
    const total=root.querySelector('.card .fw8.num-font');
    if(total){const target=document.createElement('span');target.className='fs15 muted fw7';target.textContent=week.deferred?'':` / ${formatNumber(week.weeklyTarget)}${week.unit}`;total.replaceChildren(document.createTextNode(week.deferred?'확인 중':formatNumber(summary.total)),target);}
    const badge=root.querySelector('.card .row > .chip');
    if(badge){badge.textContent=week.deferred?'조건 확인 중':summary.complete?'완료':today<week.startDate?'예정':today<=week.endDate?'진행 중':'미완료';badge.className=`chip ${summary.complete?'g':''}`;}
    root.querySelectorAll('.card .bar i').forEach((bar,index)=>bar.style.width=`${week.deferred?0:Math.min(100,Math.max(0,(index===0?summary.weekdayTotal:summary.weekendTotal)||0)/week.weeklyTarget*100)}%`);
    root.querySelectorAll('.legend span').forEach((item,index)=>{const dot=item.querySelector('i')?.cloneNode(true);item.replaceChildren(...(dot?[dot]:[]),document.createTextNode(week.deferred?'—':`${index===0?'평일':'주말'} ${formatNumber(index===0?summary.weekdayTotal:summary.weekendTotal)}${week.unit}`));});
    const daily=root.querySelector('.kv');if(daily){daily.hidden=!week.dailyTarget||week.deferred;text('.kv span',`하루 ${formatNumber(week.dailyTarget)}${week.dailyUnit} 달성`);text('.kv b',`${formatNumber(summary.weekdayAchieved)} / 5일`);}
    const lists=root.querySelectorAll('.list');const sample=lists[0].firstElementChild.cloneNode(true);lists.forEach(list=>list.replaceChildren());
    for(const date of dateRange(week.startDate,week.endDate)){
      const row=sample.cloneNode(true);const saved=recordOf(records,date);const weekend=[0,6].includes(dayIndex(date));
      const status=week.deferred?'확인 중':date>today?'예정':!saved?'미입력':week.dailyTarget&&!dailyAchieved(week,saved.value)?'일일 미달':'기록';
      const set=(selector,content)=>{const e=row.querySelector(selector);if(e)e.textContent=content;};
      set('.center .fw8',Number(date.slice(-2)));set('.center .fs12',weekdays[dayIndex(date)]);set('.grow .num-font',week.deferred||!saved?'—':valueLabel(week,saved.value));
      const weekday=row.querySelector('.center .fs12');weekday.classList.toggle('muted',!weekend);weekday.style.color=weekend?'var(--blue)':'';
      row.querySelectorAll('.chip').forEach(e=>e.remove());const label=document.createElement('span');label.className=`chip ${status==='기록'?'g':status==='일일 미달'?'red':''}`;label.textContent=status;row.append(label);
      const pending=corrections.data?.corrections?.some(c=>c.date===date&&c.status==='pending');if(pending){const badge=document.createElement('span');badge.className='chip warn';badge.textContent='정정 처리 중';row.querySelector('.grow').append(badge);}
      const attached=row.querySelector(':scope > .row.gap4');if(attached){if(!saved?.attachments?.length)attached.remove();else{const icon=attached.querySelector('svg')?.cloneNode(true);attached.replaceChildren(...(icon?[icon]:[]),document.createTextNode(saved.attachments.length));}}
      row.tabIndex=0;row.setAttribute('role','button');row.onclick=()=>navigate(`/${mode}/records/${date}`);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click();}};lists[weekend?1:0].append(row);
    }
    lists.forEach(list=>{if(!list.children.length){list.hidden=true;list.previousElementSibling.hidden=true;}});
  },[week,summary,records,today,mode,onClose,corrections.data]);
  if(mode==='mobile')return <DesignTemplate id="MS-30" setup={setup}/>;
  return <Modal title={`${week.week}주차 · ${week.title}`} onClose={onClose}><div className="fs13 t2">{dateText(week.startDate)} – {dateText(week.endDate)}</div><div className="how">{week.description}</div>{week.deferred?<div className="banner warn mt16">담당 교사의 세부 운동과 완료 조건 확인이 필요해요. 현재 입력과 판정은 보류돼요.</div>:<><WeekDays {...{week,records,today,mode}}/><div className="row mt20"><span className="grow fs14">주간 합계</span><b>{formatNumber(summary?.total)} / {formatNumber(week.weeklyTarget)}{week.unit}</b></div><div className="bar mt8"><i style={{width:`${Math.min(100,(summary?.progress||0)*100)}%`}}/></div><div className="fs13 muted mt8">{weekLabel(week,summary||{},today)}</div></>}</Modal>;
}
export function Roadmap({program,summary,onWeek,mode}) {
  const offset=mode==='web'?64:56;const xs=[-offset,0,offset,0];
  return <div className="path" style={mode==='web'?{padding:'32px 0 8px',maxWidth:420,margin:'0 auto'}:undefined}>{program.weeks.map((week,index)=>{
    const score=summaryOf(summary,week.week);const state=week.deferred||program.today<week.startDate?'lock':score.complete?'done':program.today<=week.endDate?'cur':'miss';const prev=program.weeks[index-1];const rest=prev&&dateRange(prev.endDate,week.startDate).length>2;
    return <React.Fragment key={week.week}>{rest&&<div className="rest"><Icon name="calendar" size={14}/>쉬는 기간 · 쉬어요</div>}<div className="nrow" style={{transform:`translateX(${xs[index%4]}px)`}}><button className={`node ${state}`} onClick={()=>onWeek(week)} aria-label={`${week.week}주차 ${week.title}, ${weekLabel(week,score,program.today)}`}>{score.complete?<Icon name="check" size={28}/>:week.week}<span className={`cap ${xs[index%4]>0?'l':'r'}`}>{week.title}<em className={score.complete?'ok':state==='miss'?'no':''}>{weekLabel(week,score,program.today)}</em></span></button></div></React.Fragment>;
  })}</div>;
}
