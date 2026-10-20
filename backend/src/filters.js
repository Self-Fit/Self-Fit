import { fail, requiredText } from './errors.js';
export function parseFilters(query) {
  const filters={};
  if(typeof query.search==='string'&&query.search.trim()) filters.search=requiredText(query.search,'검색어',200);
  for(const key of ['grade','classNumber','week']) if(query[key]!==undefined&&query[key]!=='') {
    const number=Number(query[key]);
    if(!Number.isSafeInteger(number)||number<1||number>2147483647||(key==='week'&&number>20)) fail(400,'INVALID_FILTER','검색 조건을 확인해 주세요.');
    filters[key]=number;
  }
  if(query.targetType) {if(!['required','optional'].includes(query.targetType)) fail(400,'INVALID_FILTER','대상 구분을 확인해 주세요.');filters.targetType=query.targetType;}
  if(query.participating!==undefined&&query.participating!=='') {if(!['true','false'].includes(query.participating)) fail(400,'INVALID_FILTER','참여 필터를 확인해 주세요.');filters.participating=query.participating==='true';}
  if(query.achievement) {if(!['complete','incomplete','pending'].includes(query.achievement)) fail(400,'INVALID_FILTER','달성 상태를 확인해 주세요.');filters.achievement=query.achievement;}
  if(query.studentIds) filters.studentIds=requiredText(query.studentIds,'선택 학생',100000).split(',').filter(Boolean);
  return filters;
}
