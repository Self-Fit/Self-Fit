import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addDays, daysBetween, shiftWeeks, suggestWeekDates, validateChallenge, normalizeWeek, MESSAGES } from '../src/challenges/validate.js';
import { legacyWeeks } from '../src/challenges/mock-legacy.js';

const docs = new URL('../../docs/challenges/', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(`fixtures/${name}`, docs), 'utf8'));
async function contractCreateExample() {
  const contract = await readFile(new URL('api-contract.md', docs), 'utf8');
  return JSON.parse(contract.split('### 챌린지 생성 요청')[1].split('```json')[1].split('```')[0]);
}
const paths = errors => errors.map(error => error.path);
const base = () => ({
  title: '테스트 챌린지', startDate: '2027-03-01',
  weeks: [
    { title: '걷기', startDate: '2027-03-01', endDate: '2027-03-07', inputType: 'walking', weeklyTarget: 5, dailyTarget: null, unit: '일', dailyUnit: '보', color: '#E07A2E', description: '' },
    { title: '줄넘기', startDate: '2027-03-08', endDate: '2027-03-14', inputType: 'count', weeklyTarget: 1000, dailyTarget: 200, unit: '회', dailyUnit: '회', color: '#2F7FD8', description: '' },
  ],
});

test('fixture challenge and the contract create example have no validation errors', async () => {
  const { challenge } = await json('challenge-detail.json');
  assert.deepEqual(validateChallenge(challenge), []);
  assert.deepEqual(validateChallenge(await contractCreateExample()), []);
});

test('legacy 2026 weeks are a valid template', () => {
  assert.deepEqual(validateChallenge({ title: '2026 Self Fit 챌린지', startDate: '2026-05-04', endDate: '2026-09-04', enrollmentDeadline: '2026-05-03', weeks: legacyWeeks }), []);
});

test('shiftWeeks keeps every gap and week length (README §4.3)', () => {
  const shifted = shiftWeeks(legacyWeeks, '2026-05-04', '2027-03-02');
  assert.equal(shifted.length, 12);
  assert.equal(shifted[0].startDate, '2027-03-02');
  assert.equal(shifted[0].endDate, '2027-03-08');
  shifted.forEach((week, index) => {
    assert.equal(daysBetween(week.startDate, week.endDate), daysBetween(legacyWeeks[index].startDate, legacyWeeks[index].endDate));
    if (index) assert.equal(daysBetween(shifted[index - 1].endDate, week.startDate), daysBetween(legacyWeeks[index - 1].endDate, legacyWeeks[index].startDate));
  });
  assert.equal(daysBetween(shifted[8].endDate, shifted[9].startDate), 36, 'summer break stays 5 weeks');
  assert.equal(shifted[11].exercises.length, 3);
});

test('suggestWeekDates starts the day after the previous week, 7 days long', () => {
  assert.deepEqual(suggestWeekDates(null, '2027-03-02'), { startDate: '2027-03-02', endDate: '2027-03-08' });
  assert.deepEqual(suggestWeekDates({ endDate: '2027-03-08' }), { startDate: '2027-03-09', endDate: '2027-03-15' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('overlapping and out-of-order weeks are reported on the later week (server messages)', () => {
  const input = base();
  input.weeks[1].startDate = '2027-03-05';
  assert.deepEqual(validateChallenge(input), [{ path: 'weeks[1].startDate', message: MESSAGES.overlap }]);
  input.weeks[1] = { ...input.weeks[1], startDate: '2027-02-20', endDate: '2027-02-26' };
  assert.ok(paths(validateChallenge(input)).includes('weeks[1].startDate'));
});

test('challenge level rules', () => {
  const input = base();
  assert.deepEqual(paths(validateChallenge({ ...input, title: ' ' })), ['title']);
  assert.deepEqual(paths(validateChallenge({ ...input, title: 'x'.repeat(61) })), ['title']);
  assert.deepEqual(paths(validateChallenge({ ...input, description: 'x'.repeat(501) })), ['description']);
  assert.deepEqual(paths(validateChallenge({ ...input, startDate: '2027-02-30' })), ['startDate', 'enrollmentDeadline'], 'no start means no default deadline (same as the server)');
  assert.deepEqual(paths(validateChallenge({ ...input, enrollmentDeadline: '2027-03-15' })), ['enrollmentDeadline']);
  assert.deepEqual(validateChallenge({ ...input, enrollmentDeadline: '2027-03-14' }), [], 'deadline may be as late as endDate');
  assert.deepEqual(paths(validateChallenge({ ...input, endDate: '2027-03-10' })), ['weeks[1].endDate']);
  assert.deepEqual(paths(validateChallenge({ ...input, endDate: '2028-03-01' })), ['endDate'], 'at most 365 days');
  assert.deepEqual(paths(validateChallenge({ ...input, weeks: [] })), ['endDate', 'weeks'], 'no weeks means no default end date');
  const many = Array.from({ length: 21 }, (_, index) => ({ ...input.weeks[0], startDate: addDays('2027-03-01', index * 7), endDate: addDays('2027-03-01', index * 7 + 6) }));
  assert.deepEqual(paths(validateChallenge({ ...input, weeks: many })), ['weeks']);
  assert.deepEqual(paths(validateChallenge({ ...input, weeks: [{ ...input.weeks[0], startDate: '2027-02-28' }] })), ['weeks[0].startDate']);
});

test('input type rules', () => {
  const week = patch => { const input = base(); input.weeks[0] = { ...input.weeks[0], ...patch }; return paths(validateChallenge(input)); };
  assert.deepEqual(week({ weeklyTarget: 8 }), ['weeks[0].weeklyTarget']);
  assert.deepEqual(week({ weeklyTarget: 0 }), ['weeks[0].weeklyTarget']);
  assert.deepEqual(week({ dailyTarget: 10000 }), [], 'walking dailyTarget is ignored');
  assert.deepEqual(week({ unit: '회' }), ['weeks[0].unit']);
  assert.deepEqual(week({ inputType: 'check', weeklyTarget: 5, dailyTarget: 'x' }), ['weeks[0].dailyTarget']);
  assert.deepEqual(week({ inputType: 'check', weeklyTarget: 5, dailyTarget: null, dailyUnit: null }), []);
  assert.deepEqual(week({ inputType: 'count', weeklyTarget: 1.5, unit: '회' }), ['weeks[0].weeklyTarget']);
  assert.deepEqual(week({ inputType: 'count', weeklyTarget: 100, dailyTarget: 2.5, unit: '회' }), ['weeks[0].dailyTarget']);
  assert.deepEqual(week({ inputType: 'count', weeklyTarget: 100, dailyTarget: 0, unit: '회' }), [], 'count daily target only needs to be an integer');
  assert.deepEqual(week({ inputType: 'count', weeklyTarget: 100, unit: '' }), ['weeks[0].unit']);
  assert.deepEqual(week({ inputType: 'distance', weeklyTarget: 0, unit: 'km' }), ['weeks[0].weeklyTarget']);
  assert.deepEqual(week({ inputType: 'distance', weeklyTarget: 2.5, dailyTarget: 0.5, unit: 'km' }), []);
  assert.deepEqual(week({ inputType: 'stretch' }), ['weeks[0].inputType']);
  assert.deepEqual(week({ color: '#12345' }), ['weeks[0].color']);
  assert.deepEqual(week({ title: '' }), ['weeks[0].title']);
});

test('dumbbell exercises: 1–5, id pattern, unique across the challenge, positive integers', () => {
  const exercise = id => ({ id, title: '운동', repetitions: 10, targetSets: 2, sideRule: '' });
  const dumbbell = exercises => ({ title: '덤벨', startDate: '2027-03-15', endDate: '2027-03-19', inputType: 'dumbbell', weeklyTarget: 3, dailyTarget: 3, unit: '일', dailyUnit: '종목', color: '#5A6372', description: '', exercises });
  const run = (...weeks) => validateChallenge({ ...base(), weeks: [...base().weeks, ...weeks] });
  assert.deepEqual(run(dumbbell([exercise('CURL')])), []);
  assert.deepEqual(paths(run(dumbbell([]))), ['weeks[2].exercises']);
  assert.deepEqual(paths(run(dumbbell(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map(exercise)))), ['weeks[2].exercises']);
  assert.deepEqual(run(dumbbell([exercise('curl')])), [{ path: 'weeks[2].exercises[0].id', message: MESSAGES.exerciseId }]);
  assert.deepEqual(paths(run(dumbbell([exercise('CURL'), exercise('CURL')]))), ['weeks[2].exercises[1].id']);
  const second = { ...dumbbell([exercise('CURL')]), startDate: '2027-03-22', endDate: '2027-03-26' };
  assert.deepEqual(paths(run(dumbbell([exercise('CURL')]), second)), ['weeks[3].exercises[0].id'], 'ids are unique across weeks');
  assert.deepEqual(paths(run(dumbbell([{ ...exercise('CURL'), repetitions: 0, targetSets: 1.5 }]))), ['weeks[2].exercises[0].repetitions', 'weeks[2].exercises[0].targetSets']);
});

test('normalizeWeek stores what the contract says the server stores', () => {
  const walking = normalizeWeek({ id: 'w1', week: 1, title: ' 걷기 ', startDate: '2027-03-01', endDate: '2027-03-07', inputType: 'walking', weeklyTarget: 5, dailyTarget: 10000, unit: 'x', dailyUnit: '', color: '#e07a2e', exercises: [] });
  assert.deepEqual(walking, { title: '걷기', startDate: '2027-03-01', endDate: '2027-03-07', inputType: 'walking', weeklyTarget: 5, dailyTarget: null, unit: '일', dailyUnit: null, color: '#E07A2E', description: '' });
});
