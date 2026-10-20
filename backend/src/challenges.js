import { isDeepStrictEqual } from 'node:util';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireRole } from './auth.js';
import { fail } from './errors.js';
import { activityDates, challengePhase, koreanDate, shiftWeeks, validateWeeks } from './domain/index.js';
import { addMembers, listMembers, previewMembers, removeMember } from './memberships.js';

const includeWeeks = { weeks: { orderBy: { week: 'asc' } } };
const editableFields = ['title', 'description', 'startDate', 'endDate', 'enrollmentDeadline', 'weeks'];
const weekFields = ['title', 'startDate', 'endDate', 'inputType', 'weeklyTarget', 'dailyTarget', 'unit', 'dailyUnit', 'color', 'description'];
const cosmeticFields = ['title', 'description', 'color'];
const emptyCounts = () => ({ active: 0, pending: 0, declined: 0, forced: 0, invited: 0 });
const invalid = (path, message) => fail(400, 'INVALID_CHALLENGE', '챌린지 설정을 확인해 주세요.', [{ path, message }]);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function bodyFields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('', '요청은 객체로 입력해 주세요.');
  for (const key of Object.keys(input)) if (!allowed.includes(key)) invalid(key, '변경할 수 없는 항목이에요.');
}

function previousDate(value) {
  if (!validDate(value)) return undefined;
  return new Date(Date.parse(`${value}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}

function normalizedWeek(week) {
  if (!week || typeof week !== 'object' || Array.isArray(week)) return week;
  return {
    ...Object.fromEntries(weekFields.map(key => [key, week[key]])),
    title: typeof week.title === 'string' ? week.title.trim() : week.title,
    description: week.description === undefined ? '' : week.description,
    dailyTarget: week.inputType === 'walking' ? null : (week.dailyTarget ?? null),
    dailyUnit: week.dailyUnit ?? null,
    ...(week.inputType === 'dumbbell' ? { exercises: week.exercises } : {}),
  };
}

function normalizedInput(input) {
  const weeks = Array.isArray(input.weeks) ? input.weeks.map(normalizedWeek) : input.weeks;
  return {
    title: typeof input.title === 'string' ? input.title.trim() : input.title,
    description: input.description === undefined ? '' : input.description,
    startDate: input.startDate,
    endDate: input.endDate === undefined ? weeks?.at?.(-1)?.endDate : input.endDate,
    enrollmentDeadline: input.enrollmentDeadline === undefined ? previousDate(input.startDate) : input.enrollmentDeadline,
    weeks,
  };
}

function validate(input) {
  const result = validateWeeks(input);
  if (!result.valid) fail(400, 'INVALID_CHALLENGE', '챌린지 설정을 확인해 주세요.', result.details);
}

const storedWeeks = weeks => weeks.map((week, index) => ({ ...week, week: index + 1 }));
const challengeFields = input => ({
  title: input.title, description: input.description, year: Number(input.startDate.slice(0, 4)),
  startDate: input.startDate, endDate: input.endDate, enrollmentDeadline: input.enrollmentDeadline,
});

/** Counts include declined invitations but exclude removed memberships. */
export async function challengeCounts(db, ids) {
  const counts = new Map(ids.map(id => [id, emptyCounts()]));
  if (!ids.length) return counts;
  const groups = await db.challengeMembership.groupBy({
    by: ['challengeId', 'status', 'mode'],
    where: { challengeId: { in: ids }, status: { not: 'removed' } },
    _count: { _all: true },
  });
  for (const row of groups) {
    const result = counts.get(row.challengeId);
    if (!result) continue;
    if (Object.hasOwn(result, row.status)) result[row.status] += row._count._all;
    if (Object.hasOwn(result, row.mode)) result[row.mode] += row._count._all;
  }
  return counts;
}

export function challengeDto(challenge, today = koreanDate(), { detail = true } = {}) {
  const weeks = challenge.weeks || [];
  const summary = {
    id: challenge.id, title: challenge.title, description: challenge.description,
    year: challenge.year, lifecycle: challenge.lifecycle, phase: challengePhase(challenge, today),
    startDate: challenge.startDate, endDate: challenge.endDate,
    enrollmentDeadline: challenge.enrollmentDeadline, today, weekCount: weeks.length,
    sourceChallengeId: challenge.sourceChallengeId ?? null,
    counts: { ...emptyCounts(), ...challenge.counts },
    createdAt: challenge.createdAt, updatedAt: challenge.updatedAt,
  };
  if (!detail) return summary;
  return {
    ...summary,
    weeks: weeks.map(week => ({
      id: week.id, week: week.week,
      ...Object.fromEntries(weekFields.map(key => [key, week[key] ?? null])),
      ...(week.inputType === 'dumbbell' ? { exercises: week.exercises } : {}),
    })),
    activityDates: activityDates(weeks),
  };
}

export async function loadChallenge(db, id) {
  if (typeof id !== 'string' || !id) fail(404, 'CHALLENGE_NOT_FOUND', '챌린지를 찾을 수 없어요.');
  const challenge = await db.challenge.findUnique({ where: { id }, include: includeWeeks });
  if (!challenge) fail(404, 'CHALLENGE_NOT_FOUND', '챌린지를 찾을 수 없어요.');
  return { ...challenge, counts: (await challengeCounts(db, [id])).get(id) };
}

async function lockedChallenge(tx, id) {
  if (typeof id !== 'string' || !id) fail(404, 'CHALLENGE_NOT_FOUND', '챌린지를 찾을 수 없어요.');
  const found = await tx.$queryRaw`SELECT id FROM "Challenge" WHERE id = ${id} FOR UPDATE`;
  if (!found.length) fail(404, 'CHALLENGE_NOT_FOUND', '챌린지를 찾을 수 없어요.');
  return loadChallenge(tx, id);
}

async function transaction(db, operation) {
  // A retry re-reads lifecycle and dates after competing edits; no outside effect is
  // performed by these callbacks.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // PostgreSQL serialization/deadlock failures from a raw row-lock query are
      // wrapped as P2010 rather than Prisma's usual P2034 transaction conflict.
      const conflict = error.code === 'P2034'
        || (error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code));
      if (!conflict) throw error;
      if (attempt >= 2) fail(409, 'CONFLICT', '동시에 변경된 챌린지예요. 새로고침 후 다시 시도해 주세요.');
    }
  }
}

export async function createChallenge(db, input, actorId) {
  bodyFields(input, editableFields);
  const normalized = normalizedInput(input);
  validate(normalized);
  return transaction(db, async tx => {
    const row = await tx.challenge.create({
      data: { ...challengeFields(normalized), createdById: actorId, lifecycle: 'draft', weeks: { create: storedWeeks(normalized.weeks) } },
    });
    return loadChallenge(tx, row.id);
  });
}

function lockedChanges(current, input) {
  for (const key of ['startDate', 'endDate', 'enrollmentDeadline']) if (current[key] !== input[key]) return true;
  if (current.weeks.length !== input.weeks.length) return true;
  return current.weeks.some((week, index) => {
    const before = normalizedWeek(week), after = input.weeks[index];
    const structural = value => Object.fromEntries(Object.entries(value).filter(([key]) => !cosmeticFields.includes(key)));
    return !isDeepStrictEqual(structural(before), structural(after));
  });
}

export async function updateChallenge(db, id, input) {
  bodyFields(input, editableFields);
  if (!Object.keys(input).length) invalid('', '변경할 항목을 입력해 주세요.');
  return transaction(db, async tx => {
    const current = await lockedChallenge(tx, id);
    if (current.lifecycle === 'archived') fail(409, 'CHALLENGE_ARCHIVED', '보관한 챌린지는 수정할 수 없어요.');
    const normalized = normalizedInput({ ...current, ...input });
    validate(normalized);
    const started = current.lifecycle === 'published' && koreanDate() >= current.startDate;
    if (started && lockedChanges(current, normalized)) fail(409, 'CHALLENGE_LOCKED', '시작한 챌린지는 제목·설명·색만 수정할 수 있어요.');
    await tx.challenge.update({ where: { id }, data: challengeFields(normalized) });
    if (Object.hasOwn(input, 'weeks')) {
      if (started) {
        for (const [index, week] of normalized.weeks.entries()) {
          await tx.challengeWeek.update({
            where: { id: current.weeks[index].id },
            data: Object.fromEntries(cosmeticFields.map(key => [key, week[key]])),
          });
        }
      } else {
        await tx.challengeWeek.deleteMany({ where: { challengeId: id } });
        await tx.challengeWeek.createMany({ data: storedWeeks(normalized.weeks).map(week => ({ ...week, challengeId: id })) });
      }
    }
    return loadChallenge(tx, id);
  });
}

export async function duplicateChallenge(db, id, input, actorId) {
  bodyFields(input, ['title', 'startDate']);
  if (!validDate(input.startDate)) invalid('startDate', '시작일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  return transaction(db, async tx => {
    const source = await lockedChallenge(tx, id);
    let weeks;
    try { weeks = shiftWeeks(source.weeks, source.startDate, input.startDate); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      invalid('startDate', '새 시작일로 옮긴 주차 날짜를 확인해 주세요.');
    }
    const normalized = normalizedInput({
      title: input.title === undefined ? `${source.title} (복사)` : input.title, description: source.description,
      startDate: input.startDate, weeks,
    });
    validate(normalized);
    const row = await tx.challenge.create({
      data: {
        ...challengeFields(normalized), createdById: actorId, lifecycle: 'draft', sourceChallengeId: id,
        weeks: { create: storedWeeks(normalized.weeks) },
      },
    });
    return loadChallenge(tx, row.id);
  });
}

export async function publish(db, id) {
  return transaction(db, async tx => {
    const current = await lockedChallenge(tx, id);
    if (current.lifecycle === 'archived') fail(409, 'CHALLENGE_ARCHIVED', '보관한 챌린지는 게시할 수 없어요.');
    if (current.lifecycle !== 'draft') fail(409, 'ALREADY_PUBLISHED', '이미 게시한 챌린지예요.');
    validate(current);
    await tx.challenge.update({ where: { id }, data: { lifecycle: 'published' } });
    return loadChallenge(tx, id);
  });
}

export async function archive(db, id) {
  return transaction(db, async tx => {
    const current = await lockedChallenge(tx, id);
    if (current.lifecycle !== 'published') fail(409, 'CHALLENGE_NOT_PUBLISHED', '게시한 챌린지만 보관할 수 있어요.');
    await tx.challenge.update({ where: { id }, data: { lifecycle: 'archived' } });
    return loadChallenge(tx, id);
  });
}

export async function remove(db, id) {
  return transaction(db, async tx => {
    const current = await lockedChallenge(tx, id);
    if (current.lifecycle !== 'draft') fail(409, 'CHALLENGE_NOT_DRAFT', '초안만 삭제할 수 있어요. 게시한 챌린지는 보관해 주세요.');
    await tx.challenge.delete({ where: { id } });
    return { ok: true };
  });
}

export async function resolveCurrentChallenge(db, user, explicitId) {
  if (explicitId !== undefined && explicitId !== null && explicitId !== '') {
    const challenge = await loadChallenge(db, explicitId);
    if (user.role !== 'teacher') {
      const membership = await db.challengeMembership.findUnique({ where: { challengeId_userId: { challengeId: challenge.id, userId: user.id } } });
      if (challenge.lifecycle !== 'published' || membership?.status !== 'active') fail(404, 'CHALLENGE_NOT_FOUND', '챌린지를 찾을 수 없어요.');
    }
    return challenge;
  }
  if (user.role === 'teacher') {
    const challenge = await db.challenge.findFirst({ where: { lifecycle: 'published' }, orderBy: [{ startDate: 'desc' }, { id: 'asc' }], include: includeWeeks });
    if (!challenge) return null;
    return { ...challenge, counts: (await challengeCounts(db, [challenge.id])).get(challenge.id) };
  }
  const candidates = await db.challenge.findMany({
    where: { lifecycle: 'published', memberships: { some: { userId: user.id, status: 'active' } } },
    include: includeWeeks,
  });
  const today = koreanDate(), priority = { active: 0, upcoming: 1, rest: 2, ended: 3 };
  candidates.sort((left, right) => {
    const leftPhase = challengePhase(left, today), rightPhase = challengePhase(right, today);
    if (priority[leftPhase] !== priority[rightPhase]) return priority[leftPhase] - priority[rightPhase];
    const dateOrder = leftPhase === 'upcoming' ? left.startDate.localeCompare(right.startDate)
      : leftPhase === 'ended' ? right.endDate.localeCompare(left.endDate) : right.startDate.localeCompare(left.startDate);
    return dateOrder || left.id.localeCompare(right.id);
  });
  const challenge = candidates[0];
  if (!challenge) return null;
  return { ...challenge, counts: (await challengeCounts(db, [challenge.id])).get(challenge.id) };
}

export function challengeRouter(db) {
  const router = Router();
  router.use(requireRole('teacher'));
  router.get('/', async (req, res) => {
    const lifecycle = req.query.lifecycle ?? 'all';
    if (!['all', 'draft', 'published', 'archived'].includes(lifecycle)) invalid('lifecycle', '챌린지 상태를 확인해 주세요.');
    const challenges = await db.challenge.findMany({
      where: lifecycle === 'all' ? {} : { lifecycle }, include: includeWeeks,
      orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
    });
    const counts = await challengeCounts(db, challenges.map(row => row.id)), today = koreanDate();
    res.json({ challenges: challenges.map(row => challengeDto({ ...row, counts: counts.get(row.id) }, today, { detail: false })) });
  });
  router.post('/', async (req, res) => res.status(201).json({ challenge: challengeDto(await createChallenge(db, req.body, req.user.id)) }));
  router.get('/:id', async (req, res) => res.json({ challenge: challengeDto(await loadChallenge(db, req.params.id)) }));
  router.patch('/:id', async (req, res) => res.json({ challenge: challengeDto(await updateChallenge(db, req.params.id, req.body)) }));
  router.post('/:id/duplicate', async (req, res) => res.status(201).json({ challenge: challengeDto(await duplicateChallenge(db, req.params.id, req.body, req.user.id)) }));
  router.post('/:id/publish', async (req, res) => res.json({ challenge: challengeDto(await publish(db, req.params.id)) }));
  router.post('/:id/archive', async (req, res) => res.json({ challenge: challengeDto(await archive(db, req.params.id)) }));
  router.delete('/:id', async (req, res) => res.json(await remove(db, req.params.id)));
  router.get('/:id/members', async (req, res) => res.json(await listMembers(db, req.params.id, req.query)));
  router.post('/:id/members/preview', async (req, res) => res.json(await previewMembers(db, req.params.id, req.body)));
  router.post('/:id/members', async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail(400, 'INVALID_SELECTION', '학생 선택 정보를 확인해 주세요.');
    const { mode, ...selection } = req.body;
    res.status(201).json(await addMembers(db, { challenge: req.params.id, teacher: req.user, mode, selection }));
  });
  router.delete('/:id/members/:userId', async (req, res) => res.json(await removeMember(db, req.params.id, req.params.userId)));
  return router;
}
