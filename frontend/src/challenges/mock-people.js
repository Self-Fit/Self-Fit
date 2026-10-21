// Mock-only people. The fixture users (members.json, members-add-response.json) plus a few
// fictional classmates so grade/class filters and multi-select have something to pick from.
import membersFixture from '../../../docs/challenges/fixtures/members.json';
import addFixture from '../../../docs/challenges/fixtures/members-add-response.json';

export const TEACHER = { id: 't-1', name: '검증 교사' };
/** The student the mock student API answers for (the pending invitee in members.json, as in student-challenges.json). */
export const ME = 'u-10102';

const student = (studentNumber, name, grade, classNumber, targetType, fitnessGrade = null) => ({
  id: `u-${studentNumber}`, role: 'student', studentNumber, name, grade, classNumber, targetType,
  fitnessGrade, fitnessGradeYear: fitnessGrade === null ? null : 2026, fitnessGradeSemester: fitnessGrade === null ? null : 2,
  participating: targetType === 'required', mustChangePassword: false, lastLoginAt: null, createdAt: '2026-10-20T03:10:00.000Z',
});

const fixtureUsers = [...membersFixture.members, ...addFixture.added].map(member => member.user);
export const roster = [
  ...fixtureUsers,
  student('10103', '정나래', 1, 1, 'required', 4),
  student('10104', '윤가람', 1, 1, 'optional', 5),
  student('10201', '한솔빛', 1, 2, 'required', 3),
  student('10202', '오다온', 1, 2, 'required', 4),
  student('20101', '서이든', 2, 1, 'required', 1),
  student('20102', '장우주', 2, 1, 'optional', 5),
  student('30101', '임채운', 3, 1, 'required', 2),
  student('30102', '강노을', 3, 1, 'optional'),
].filter((user, index, all) => all.findIndex(other => other.id === user.id) === index)
  .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));
