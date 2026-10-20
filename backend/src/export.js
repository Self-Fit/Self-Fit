import ExcelJS from 'exceljs';
import { WEEKS,activityDates,getWeekForDate,koreanDate,dailyStatus,summarizeProgram,summarizeWeek } from './domain/index.js';
import { sendWorkbook } from './roster.js';
const bands=['0–1,999보','2,000–3,999보','4,000–5,999보','6,000–7,999보','8,000–9,999보','10,000보 이상'];
const states={missing:'미입력',future:'예정',achieved:'달성',below_target:'목표 미달',recorded:'기록 있음 (일일 목표 없음)',zero:'명시적 0 입력',pending:'세부 규칙 확인 대기',inactive:'활동일 아님',invalid:'확인 필요'};
export function displayValue(week,value) {
  if(value===null||value===undefined) return '미입력';
  if(week.inputType==='walking') return bands[value];
  if(week.inputType==='check') return value?'수행·기준 충족':'미수행·기준 미충족';
  if(week.inputType==='dumbbell') return week.exercises.map(exercise=>`${exercise.title}: ${value[exercise.id]??'미입력'}${value[exercise.id]==null?'':'세트'}`).join(' / ');
  return value;
}
const completion=value=>value===null?'확인 대기':value?'완료':'미완료';
export async function exportCorrections(res,corrections,status) {
  const workbook=new ExcelJS.Workbook();workbook.creator='Self Fit';workbook.created=new Date();
  const sheet=workbook.addWorksheet('정정 처리 이력');
  sheet.addRow(['요청 ID','상태','날짜(한국)','학번','이름','주차','운동','변경 전 값','요청 값','요청 사유','요청 시각(한국)','처리 시각(한국)','처리 교사','반려 사유','기준 기록 버전']);
  const timestamp=value=>value?new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}):'미처리';
  for(const correction of corrections) {
    const week=getWeekForDate(correction.record.date);
    sheet.addRow([correction.id,{pending:'대기',approved:'승인',rejected:'반려'}[correction.status],correction.record.date,correction.requester.studentNumber,correction.requester.name,week?.week,week?.title,displayValue(week,correction.beforeValue),displayValue(week,correction.requestedValue),correction.reason,timestamp(correction.createdAt),timestamp(correction.decidedAt),correction.decider?.name || '미처리',correction.decisionReason || '',correction.baseVersion]);
  }
  sheet.getColumn(4).numFmt='@';
  const meta=workbook.addWorksheet('추출 정보');
  meta.addRows([['항목','값'],['추출 시각(한국)',timestamp(new Date())],['운영 연도',2026],['상태 필터',status],['해석','요청 시점의 원값과 요청값을 보관한 이력입니다. 현재 유효 기록 내보내기는 별도 메뉴를 사용합니다.']]);
  await sendWorkbook(res,workbook,`self-fit-corrections-${koreanDate()}.xlsx`);
}
export async function exportStudents(res,students,filters) {
  const workbook=new ExcelJS.Workbook();workbook.creator='Self Fit';workbook.created=new Date();
  const summary=workbook.addWorksheet('참여자 요약');
  summary.addRow(['학번','이름','학년','반','대상 구분','참여 여부','완료 주차 수','전체 주차','전체 완료','완료율(완료 주차÷12)','미확정 주차']);
  const weekly=workbook.addWorksheet('주차별 현황');
  weekly.addRow(['학번','이름','주차','운동','목표','단위','평일 실적','주말 실적','주말 보충 인정일','전체 실적','완료','참여 여부']);
  const daily=workbook.addWorksheet('날짜별 기록');
  daily.addRow(['학번','이름','날짜(한국)','주차','운동','입력 유형','현재 유효 입력값','일일 상태','주말 여부','사진 수','영상 수','정정 상태','기록 상세(로그인 필요)','참여 여부']);
  const dumbbell=workbook.addWorksheet('덤벨 상세');
  dumbbell.addRow(['학번','이름','활동일','운동 식별값','운동명','세트당 반복 수','목표 세트','완료 세트','환산 횟수','종목 목표 충족','좌우 수행 기준','일일 상태','참여 여부']);
  const weeks=filters.week?WEEKS.filter(week=>week.week===filters.week):WEEKS;
  const dates=weeks.flatMap(week=>activityDates(week));
  for(const user of students) {
    const total=summarizeProgram(user.records);const participation=user.participating?'참여':'미참여 (성과 집계 제외)';
    summary.addRow([user.studentNumber,user.name,user.grade,user.classNumber,user.targetType==='required'?'필수':'선택',participation,user.participating?total.completedWeeks:'집계 제외',12,user.participating?completion(total.complete):'집계 제외',user.participating?total.progress:'집계 제외',total.pendingWeeks.join(', ')]);
    for(const week of weeks) {
      const result=summarizeWeek(week,user.records);
      weekly.addRow([user.studentNumber,user.name,week.week,week.title,week.weeklyTarget??'미확정',week.unit,result.weekdayTotal??'미확정',result.weekendTotal??'미확정',result.makeupDays??'해당 없음',result.total??'미확정',user.participating?completion(result.complete):'집계 제외',participation]);
    }
    const byDate=new Map(user.records.map(record=>[record.date,record]));
    for(const date of dates) {
      const record=byDate.get(date);const week=getWeekForDate(date);const day=new Date(`${date}T00:00:00Z`).getUTCDay();
      const corrections=record?.corrections || [];const pending=corrections.find(c=>c.status==='pending');
      const detailUrl=`${(process.env.APP_ORIGIN || 'http://localhost:5173').split(',')[0].replace(/\/$/,'')}/web/admin/students/${encodeURIComponent(user.id)}?date=${date}`;
      daily.addRow([user.studentNumber,user.name,date,week.week,week.title,week.inputType,displayValue(week,record?.value),states[dailyStatus(week,record?.value,date)],day===0||day===6?'주말':'평일',record?.attachments?.filter(file=>file.kind==='image').length||0,record?.attachments?.filter(file=>file.kind==='video').length||0,pending?'정정 처리 중 (원기록 유효)':corrections[0]?.status || '없음',record?{text:'기록 상세 열기',hyperlink:detailUrl,tooltip:'로그인 및 교사 권한이 필요합니다.'}:'미입력',participation]);
      if(week.inputType==='dumbbell') for(const exercise of week.exercises) {
        const sets=record?.value?.[exercise.id],missing=sets===null||sets===undefined;
        const exactRepetitions=missing?null:BigInt(sets)*BigInt(exercise.repetitions);
        const repetitions=missing?'미입력':exactRepetitions<=BigInt(Number.MAX_SAFE_INTEGER)?Number(exactRepetitions):String(exactRepetitions);
        dumbbell.addRow([user.studentNumber,user.name,date,exercise.id,exercise.title,exercise.repetitions,exercise.targetSets,missing?'미입력':sets,repetitions,missing?'미입력':sets>=exercise.targetSets?'충족':'미충족',exercise.sideRule,states[dailyStatus(week,record?.value,date)],participation]);
      }
    }
  }
  const meta=workbook.addWorksheet('추출 정보');
  meta.addRows([['항목','값'],['추출 시각(한국)',new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul'})],['기준 운영 연도',2026],['적용 필터',JSON.stringify(filters)],['집계 대상',`${students.filter(user=>user.participating).length}명 (선택 미참여 제외)`],['미입력','미입력은 0·미충족과 구분합니다.'],['걷기 구간','정확한 걸음 수나 합계가 아닙니다. 최저 구간도 실제 0보를 뜻하지 않습니다.'],['누적형','별도의 일일 목표가 없는 운동은 일일 실패를 판정하지 않습니다.'],['정정','승인 전 원기록, 승인 후 승인된 현재값을 사용합니다.'],['첨부','원본 파일은 포함하지 않습니다. 상세 화면에는 로그인이 필요합니다.'],['덤벨','컬·스쿼트·로우 각각 10회×2세트 충족 시 완료일, 5일 중 3일 완료 시 주차 완료. 환산 횟수=완료 세트×10, 좌우를 다시 곱하지 않습니다.']]);
  for(const sheet of [summary,weekly,daily,dumbbell]) sheet.getColumn(1).numFmt='@';
  summary.getColumn(10).numFmt='0.0%';
  await sendWorkbook(res,workbook,`self-fit-${koreanDate()}.xlsx`);
}
