import { Prisma } from '@prisma/client';
import { fail } from './errors.js';
import { parseFilters } from './filters.js';
import { userDto } from './dto.js';
import { koreanDate } from './domain/index.js';

const memberInclude = { user: true, invitedBy: { select: { id: true, name: true } } };
const statuses = ['active', 'pending', 'declined', 'removed'];
const modes = ['forced', 'invited'];
const studentOrder = [{ grade: 'asc' }, { classNumber: 'asc' }, { studentNumber: 'asc' }, { id: 'asc' }];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const selectionError = message => fail(400, 'INVALID_SELECTION', message);
const filterError = () => fail(400, 'INVALID_FILTER', '참여자 검색 조건을 확인해 주세요.');

export function membershipSelf(member) {
  return member ? {
    mode: member.mode, status: member.status,
    invitedAt: member.invitedAt, respondedAt: member.respondedAt ?? null,
  } : null;
}

export function membershipDto(member) {
  return {
    id: member.id, challengeId: member.challengeId,
    user: userDto({ ...member.user, participating: member.status === 'active' }),
    ...membershipSelf(member),
    invitedBy: member.invitedBy ? { id: member.invitedBy.id, name: member.invitedBy.name } : null,
  };
}

function validateSelection(selection) {
  if (!object(selection) || Object.keys(selection).some(key => !['studentIds', 'filters'].includes(key))
    || Object.hasOwn(selection, 'studentIds') === Object.hasOwn(selection, 'filters')) {
    selectionError('학생 목록과 학년·반 필터 중 하나만 선택해 주세요.');
  }
  let encoded;
  try { encoded = JSON.stringify(selection); }
  catch { selectionError('학생 선택 형식을 확인해 주세요.'); }
  if (encoded.length > 100_000) selectionError('학생 선택 정보는 100,000자 이내로 입력해 주세요.');
  if (Object.hasOwn(selection, 'studentIds')) {
    if (!Array.isArray(selection.studentIds) || !selection.studentIds.length
      || selection.studentIds.some(id => typeof id !== 'string' || !id.trim())) {
      selectionError('학생 ID는 비어 있지 않은 문자열 목록으로 입력해 주세요.');
    }
    return { ids: [...new Set(selection.studentIds.map(id => id.trim()))] };
  }
  const filters = selection.filters;
  if (!object(filters) || Object.keys(filters).some(key => !['grade', 'classNumber', 'targetType', 'fitnessGrades'].includes(key))) {
    selectionError('학년·반·대상 구분·체력등급 필터만 사용할 수 있어요.');
  }
  for (const field of ['grade', 'classNumber']) {
    if (Object.hasOwn(filters, field) && !(typeof filters[field] === 'number'
      || (typeof filters[field] === 'string' && /^\d+$/.test(filters[field])))) selectionError('학년과 반은 양의 정수로 입력해 주세요.');
  }
  if (Object.hasOwn(filters, 'targetType') && !['required', 'optional'].includes(filters.targetType)) selectionError('필수 또는 선택 대상을 골라 주세요.');
  if (Object.hasOwn(filters, 'fitnessGrades') && (!Array.isArray(filters.fitnessGrades) || !filters.fitnessGrades.length
    || filters.fitnessGrades.some(grade => !Number.isInteger(grade) || grade < 1 || grade > 5))) selectionError('체력등급은 1~5의 정수 목록으로 하나 이상 선택해 주세요.');
  try {
    const { fitnessGrades, ...otherFilters } = filters;
    return { filters: { ...parseFilters(otherFilters), ...(fitnessGrades ? { fitnessGrade: { in: [...new Set(fitnessGrades)].sort((a,b)=>a-b) } } : {}) } };
  }
  catch (error) {
    if (error.status !== 400) throw error;
    selectionError('학년·반·대상 구분 필터를 확인해 주세요.');
  }
}

/** Explicit IDs retain missing/teacher candidates so add can explain every skip. */
export async function selectStudents(db, selection) {
  const parsed = validateSelection(selection);
  if (parsed.ids) {
    const users = await db.user.findMany({ where: { id: { in: parsed.ids } }, orderBy: studentOrder });
    const byId = new Map(users.map(user => [user.id, user]));
    return parsed.ids.map(id => byId.get(id) || { id, role: null, studentNumber: null, name: null });
  }
  return db.user.findMany({ where: { role: 'student', ...parsed.filters }, orderBy: studentOrder });
}

async function existingChallenge(db, id, { lock = false, invitation = false } = {}) {
  const missing = () => fail(404, invitation ? 'NO_INVITATION' : 'CHALLENGE_NOT_FOUND',
    invitation ? '대기 중인 초대가 없어요.' : '챌린지를 찾을 수 없어요.');
  if (typeof id !== 'string' || !id) missing();
  if (lock) {
    const found = await db.$queryRaw`SELECT id FROM "Challenge" WHERE id = ${id} FOR UPDATE`;
    if (!found.length) missing();
  }
  const challenge = await db.challenge.findUnique({ where: { id } });
  if (!challenge) missing();
  return challenge;
}

async function lockMemberships(tx, challengeId) {
  // Every membership mutation locks its parent first, then membership rows in the
  // same order as other membership mutations. Record writes take a parent SHARE lock.
  await tx.$queryRaw`SELECT id FROM "ChallengeMembership" WHERE "challengeId" = ${challengeId} ORDER BY "userId" FOR UPDATE`;
}

async function transaction(db, operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 });
    } catch (error) {
      const conflict = error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code));
      if (!conflict) throw error;
      if (attempt >= 2) fail(409, 'CONFLICT', '동시에 변경된 참여 정보예요. 새로고침 후 다시 시도해 주세요.');
    }
  }
}

export async function previewMembers(db, challengeId, selection) {
  validateSelection(selection);
  await existingChallenge(db, challengeId);
  const students = (await selectStudents(db, selection)).filter(user => user.role === 'student');
  const members = await db.challengeMembership.findMany({ where: { challengeId, userId: { in: students.map(user => user.id) } } });
  const byUser = new Map(members.map(member => [member.userId, member]));
  return { students: students.map(user => {
    const member = byUser.get(user.id);
    return { ...userDto({ ...user, participating: member?.status === 'active' }), membership: membershipSelf(member) };
  }) };
}

function listFilters(query) {
  if (!object(query) || Object.keys(query).some(key => !['status', 'mode', 'grade', 'classNumber', 'targetType', 'fitnessGrade', 'search'].includes(key))) filterError();
  for (const field of ['grade', 'classNumber', 'targetType', 'fitnessGrade', 'search']) {
    if (query[field] !== undefined && !['string', 'number'].includes(typeof query[field])) filterError();
  }
  for (const field of ['targetType', 'search']) if (query[field] !== undefined && typeof query[field] !== 'string') filterError();
  const cohort = parseFilters(Object.fromEntries(['grade', 'classNumber', 'targetType', 'fitnessGrade', 'search']
    .filter(key => query[key] !== undefined).map(key => [key, query[key]])));
  const selectedStatuses = query.status === undefined || query.status === '' ? ['active', 'pending', 'declined']
    : typeof query.status === 'string' ? [...new Set(query.status.split(','))] : [];
  if (!selectedStatuses.length || selectedStatuses.some(status => !statuses.includes(status))) filterError();
  if (query.mode !== undefined && query.mode !== '' && !modes.includes(query.mode)) filterError();
  const user = { role: 'student' };
  for (const key of ['grade', 'classNumber', 'targetType']) if (cohort[key] !== undefined) user[key] = cohort[key];
  if (cohort.fitnessGrade !== undefined) user.fitnessGrade = cohort.fitnessGrade === 'unmeasured' ? null : cohort.fitnessGrade;
  if (cohort.search) user.OR = [{ name: { contains: cohort.search, mode: 'insensitive' } }, { studentNumber: { contains: cohort.search, mode: 'insensitive' } }];
  return { user, status: { in: selectedStatuses }, ...(query.mode ? { mode: query.mode } : {}) };
}

export async function listMembers(db, challengeId, query = {}) {
  const filters = listFilters(query);
  await existingChallenge(db, challengeId);
  const [members, grouped] = await Promise.all([
    db.challengeMembership.findMany({
      where: { challengeId, ...filters }, include: memberInclude,
      orderBy: [{ user: { grade: 'asc' } }, { user: { classNumber: 'asc' } }, { user: { studentNumber: 'asc' } }, { userId: 'asc' }],
    }),
    db.challengeMembership.groupBy({
      by: ['status', 'mode'], where: { challengeId, user: filters.user }, _count: { _all: true },
    }),
  ]);
  const stats = { active: 0, pending: 0, declined: 0, removed: 0, forced: 0, invited: 0 };
  for (const group of grouped) {
    stats[group.status] += group._count._all;
    if (group.status !== 'removed') stats[group.mode] += group._count._all;
  }
  return { members: members.map(membershipDto), stats };
}

const challengeKey = challenge => typeof challenge === 'string' ? challenge : challenge?.id;
const teacherKey = teacher => typeof teacher === 'string' ? teacher : teacher?.id;
const skip = (user, reason) => ({ userId: user.id, studentNumber: user.studentNumber ?? null, name: user.name ?? null, reason });
const nextInvitationTime = previous => new Date(Math.max(Date.now(), previous ? new Date(previous).getTime() + 1 : 0));

async function notifyEnrollment(tx, challenge, member) {
  const invitation = member.mode === 'invited';
  const eventKey = invitation ? `invitation:${member.id}:${member.invitedAt.toISOString()}` : `enrollment:${member.id}`;
  const data = {
    userId: member.userId, eventKey, type: invitation ? 'invitation' : 'enrollment',
    title: invitation ? '새 챌린지에 초대됐어요' : '새 챌린지에 참여하게 됐어요',
    body: invitation ? `${challenge.title}에 초대됐어요. ${challenge.enrollmentDeadline}까지 참여 여부를 알려 주세요.` : `${challenge.title}에 참여가 등록됐어요. 운동 목표를 확인해 주세요.`,
    data: { challengeId: challenge.id, membershipId: member.id },
  };
  // Forced re-registration reuses the contract's stable membership event key.
  // Keep the original event and delivery/read state rather than duplicating it.
  await tx.notification.upsert({ where: { eventKey }, create: data, update: {} });
}

export async function addMembers(db, { challenge, teacher, mode, students, selection }) {
  if (!modes.includes(mode)) selectionError('강제 참여 또는 초대 방식을 선택해 주세요.');
  const requested = selection ?? { studentIds: students?.map(user => typeof user === 'string' ? user : user?.id) };
  validateSelection(requested);
  return transaction(db, async tx => {
    const current = await existingChallenge(tx, challengeKey(challenge), { lock: true });
    if (current.lifecycle !== 'published') fail(409, 'CHALLENGE_NOT_PUBLISHED', '게시한 챌린지에만 학생을 등록할 수 있어요.');
    const today = koreanDate();
    if (today > (mode === 'invited' ? current.enrollmentDeadline : current.endDate)) fail(409, 'ENROLLMENT_CLOSED', '이 챌린지의 참여 등록 기간이 지났어요.');
    await lockMemberships(tx, current.id);
    const selected = await selectStudents(tx, requested);
    const existing = await tx.challengeMembership.findMany({ where: { challengeId: current.id, userId: { in: selected.map(user => user.id) } } });
    const byUser = new Map(existing.map(member => [member.userId, member]));
    const added = [], skipped = [];
    for (const user of selected) {
      if (!user.role) { skipped.push(skip(user, 'not_found')); continue; }
      if (user.role !== 'student') { skipped.push(skip(user, 'not_student')); continue; }
      const member = byUser.get(user.id);
      if (member?.status === 'active') { skipped.push(skip(user, 'already_active')); continue; }
      if (member?.status === 'pending' && mode === 'invited') { skipped.push(skip(user, 'already_pending')); continue; }
      const data = {
        mode, status: mode === 'forced' ? 'active' : 'pending',
        invitedById: teacherKey(teacher), invitedAt: nextInvitationTime(member?.invitedAt), respondedAt: null,
      };
      let updated;
      if (member) {
        const result = await tx.challengeMembership.updateMany({ where: { id: member.id, status: member.status, mode: member.mode }, data });
        if (!result.count) fail(409, 'CONFLICT', '학생의 참여 상태가 변경됐어요. 새로고침해 주세요.');
        updated = await tx.challengeMembership.findUnique({ where: { id: member.id }, include: memberInclude });
      } else {
        updated = await tx.challengeMembership.create({ data: { ...data, challengeId: current.id, userId: user.id }, include: memberInclude });
      }
      await notifyEnrollment(tx, current, updated);
      added.push(membershipDto(updated));
    }
    return { added, skipped };
  });
}

export async function removeMember(db, challengeId, userId) {
  return transaction(db, async tx => {
    await existingChallenge(tx, challengeId, { lock: true });
    await lockMemberships(tx, challengeId);
    const member = await tx.challengeMembership.findUnique({ where: { challengeId_userId: { challengeId, userId } } });
    if (!member || member.status === 'removed') fail(404, 'NOT_MEMBER', '제외할 참여자를 찾을 수 없어요.');
    if (await tx.dailyRecord.count({ where: { challengeId, userId } })) fail(409, 'HAS_RECORDS', '운동 기록이 있는 참여자는 제외할 수 없어요.');
    const updated = await tx.challengeMembership.updateMany({ where: { id: member.id, status: member.status }, data: { status: 'removed' } });
    if (!updated.count) fail(404, 'NOT_MEMBER', '이미 제외한 참여자예요.');
    return { ok: true };
  });
}

async function respondInTransaction(tx, challengeId, userId, accept) {
  const challenge = await existingChallenge(tx, challengeId, { lock: true, invitation: true });
  if (challenge.lifecycle !== 'published') fail(404, 'NO_INVITATION', '대기 중인 초대가 없어요.');
  await lockMemberships(tx, challengeId);
  const member = await tx.challengeMembership.findUnique({ where: { challengeId_userId: { challengeId, userId } } });
  if (!member || member.mode !== 'invited' || member.status !== 'pending') fail(404, 'NO_INVITATION', '대기 중인 초대가 없어요.');
  if (accept && koreanDate() > challenge.enrollmentDeadline) fail(409, 'INVITATION_CLOSED', '초대 수락 기간이 지났어요.');
  const respondedAt = new Date(Math.max(Date.now(), new Date(member.invitedAt).getTime())), status = accept ? 'active' : 'declined';
  const result = await tx.challengeMembership.updateMany({ where: { id: member.id, mode: 'invited', status: 'pending' }, data: { status, respondedAt } });
  if (!result.count) fail(404, 'NO_INVITATION', '이미 응답한 초대예요.');
  return membershipSelf({ ...member, status, respondedAt });
}

export async function acceptOnlyInvitation(db, userId) {
  return transaction(db, async tx => {
    const candidates = await tx.challengeMembership.findMany({
      where: { userId, mode: 'invited', status: 'pending', challenge: { lifecycle: 'published', enrollmentDeadline: { gte: koreanDate() } } },
      select: { challengeId: true }, orderBy: { challengeId: 'asc' },
    });
    if (!candidates.length) fail(403, 'ENROLLMENT_CLOSED', '수락할 수 있는 초대가 없어요.');
    if (candidates.length > 1) fail(409, 'INVITATION_SELECTION_REQUIRED', '여러 챌린지에 초대됐어요. 참여할 챌린지를 골라 주세요.', { challengeIds: candidates.map(member => member.challengeId) });
    return respondInTransaction(tx, candidates[0].challengeId, userId, true);
  });
}

export const acceptInvitation = (db, challengeId, userId) => transaction(db, tx => respondInTransaction(tx, challengeId, userId, true));
export const declineInvitation = (db, challengeId, userId) => transaction(db, tx => respondInTransaction(tx, challengeId, userId, false));
