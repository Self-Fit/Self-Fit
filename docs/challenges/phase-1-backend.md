# Phase 1 · 백엔드 — 스키마, 도메인 일반화, 챌린지 CRUD/재활용

브랜치 `feat/challenges-be-1`. 범위는 `backend/`, `scripts/`, 이 폴더의 문서. 프런트는 건드리지 않는다.
완료 기준은 맨 아래. 계약은 [api-contract.md](./api-contract.md), 모델·규칙은 [README.md](./README.md) §3–§5.

## 0. 시작 전에
- `npm install && npm run setup && npm test`가 현재 main에서 통과하는지 확인한다(통합 테스트는 `TEST_DATABASE_URL` 필요).
- 레거시 집계의 기준값을 먼저 뽑아 둔다: 통합 테스트 안에서 `summarizeProgram`(기존)과 새 `summarizeProgram(LEGACY_WEEKS, …)` 결과를 비교하는 테스트를 **먼저** 쓴다(아래 5번).

## 1. 스키마와 마이그레이션 (`backend/prisma/`)
새 마이그레이션 폴더 `2026MMDDHHMMSS_challenges`. 한 파일 안에서 순서대로:
1. `Challenge`, `ChallengeWeek`, `ChallengeMembership` 테이블 + CHECK 제약(README §3). `DailyRecord.challengeId TEXT NULL`, `Notification.data JSONB NULL` 추가.
2. 레거시 챌린지 1건 INSERT: id는 고정 문자열 `'challenge-2026-self-fit'`(테스트·스크립트가 참조), `title='2026 Self Fit 챌린지'`, `year=2026`, `lifecycle='published'`, `startDate='2026-05-04'`, `endDate='2026-09-04'`, `enrollmentDeadline='2026-05-03'`, `createdById`는 교사 계정(없으면 임시로 첫 사용자 — 통합 테스트 스키마에는 사용자가 없으므로 `createdById`는 NULL 허용으로 두고 애플리케이션에서 채운다).
3. `ChallengeWeek` 12행 INSERT: `backend/src/domain/index.js`의 `definitions` 값을 **그대로**(제목·날짜·inputType·목표·단위·색·설명·`dailyUnit`). 12주차 `exercises`는 현재 `DUMBBELL_EXERCISES` JSON(`D12_CURL`…).
4. `UPDATE "DailyRecord" SET "challengeId"='challenge-2026-self-fit'` → `NOT NULL` → 기존 `DailyRecord_userId_date_key` 삭제 후 `@@unique([challengeId,userId,date])` + `@@index([userId,date])`.
5. 참여 백필: `role='student'`인 사용자마다 `targetType='required'` → `forced/active`, `optional AND participating` → `invited/active`, 그 외는 행을 만들지 않는다. `invitedById`는 교사 계정(없으면 NULL 허용).
6. Prisma 스키마를 같은 내용으로 갱신하고 `prisma migrate diff`로 드리프트가 없는지 확인한다.

주의: 팀원의 적재 스크립트(`backend/scripts/import-participation.js`, `import-dumbbell-data.js`, `import-revised-participation.js`)는 `DailyRecord`를 직접 만든다. `challengeId`를 넣도록 고치고(헬퍼 `legacyChallengeId(db)`를 `backend/scripts/participation-data.js`에 export), 해당 테스트 4개가 그대로 통과해야 한다.

## 2. 도메인 일반화 (`backend/src/domain/index.js`)
- `WEEKS` → `LEGACY_WEEKS`로 이름을 바꾸고 계속 export한다(마이그레이션 값·적재 스크립트·테스트 전용). `DUMBBELL_EXERCISES`도 `LEGACY_DUMBBELL_EXERCISES`.
- 아래 함수는 첫 인자로 `weeks`(주차 배열, 각 항목은 `Week` 모양)를 받는다. 시그니처를 바꾸고 모든 호출부를 고친다:
  `getWeekForDate(weeks,date)`, `activityDates(weeks,week?)`, `canWriteDate(weeks,date,today?)`, `summarizeProgram(weeks,records)`, `reminderDecision(weeks,user,records,date)`.
  `summarizeWeek(week,records)`, `validateValue(week,value)`, `dailyStatus(week,value,date,today?)`는 주차 객체를 이미 받으므로 그대로.
- 덤벨: `DUMBBELL_EXERCISES` 상수 대신 `week.exercises`를 쓴다(`isDumbbellShape`, `hasSubmittedValue`, `valueAchieved`, `validateValue`). 주차에 `exercises`가 없으면 검증 실패.
- `WEEKS.length`를 쓰던 곳(`totalWeeks`, `progress`)은 `weeks.length`.
- 새로 export: `validateWeeks(challengeInput) → {valid, details:[{path,message}]}`(계약의 검증 규칙 전부), `challengePhase(challenge, today)`, `shiftWeeks(weeks, fromStart, toStart)`(평행 이동).
- 하드코딩된 `'2026-05-04'`, `'2026-09-04'`는 전부 `challenge.startDate/endDate`로 치환한다(`notifications.js`, `dto.js`, `student.js` 포함). 치환 후 `grep -rn "2026-0" backend/src`에 `LEGACY_WEEKS` 정의 외에는 남지 않아야 한다.

## 3. 챌린지 서비스와 라우터
- `backend/src/challenges.js`: `challengeDto(challenge, today)`(ChallengeSummary/Challenge), `loadChallenge(db,id)`, `createChallenge`, `updateChallenge`(락 규칙), `duplicateChallenge`, `publish`, `archive`, `remove`, `resolveCurrentChallenge(db,user)`(README §5).
- `backend/src/teacher.js`에 `router.use('/challenges', challengeRouter(db))`. 엔드포인트는 계약의 교사 표 중 **members 제외 전부**.
- `counts`는 `ChallengeMembership`을 `groupBy`로 집계한다(phase 2 전에는 레거시 백필 값만 있음).
- `programDto(challenge)`로 바꾸고 `GET /program`은 `resolveCurrentChallenge`로 해석한 챌린지를 돌려준다(+`challengeId`). 현재 챌린지가 없으면 `404 CHALLENGE_NOT_FOUND`.
- 교사 기존 API에 `challengeId` 쿼리 추가(계약 "기존 교사 API"): `overview`, `participation`, `export`, `corrections`, `students/:id`. 기록·분모를 그 챌린지로 제한하고 응답에 `challenge`를 넣는다. 분모는 `ChallengeMembership.status='active'`(백필 덕분에 결과는 기존과 동일해야 한다).
- 학생 레거시 경로(`/student/dashboard`, `/student/records*`, `/student/enroll`)는 `resolveCurrentChallenge`로 범위를 잡는다. 학생 챌린지 전용 경로는 phase 2.
- 알림 스케줄러: `createReminderEvents`는 published·phase active인 챌린지마다 돌고, `eventKey`는 `reminder:<challengeId>:<userId>:<date>`. 기존 키는 그대로 둔다.

## 4. 문서
- `backend/API.md`에 "챌린지" 절을 추가하되 내용은 `docs/challenges/api-contract.md`로 링크한다. `programDto` 변화(`challengeId`)와 `challengeId` 쿼리를 적는다.
- `backend/README.md` 실행 안내에 마이그레이션 주의(기록 백필, 고정 id)를 한 단락 추가.

## 5. 테스트 (`backend/test/`)
- `domain.test.js`: 시그니처 변경 반영. 레거시 값으로 결과가 **바뀌지 않음**을 기존 케이스가 증명한다.
- 새 `challenges.test.js`(DB 없음): `validateWeeks` 모든 규칙(겹침, 범위 밖, inputType별 목표, 덤벨 id 규칙, 색), `challengePhase`, `shiftWeeks`(휴식 간격 유지, endDate 재계산).
- `integration.test.js`에 하위 테스트 추가:
  - 마이그레이션 직후 레거시 챌린지가 있고 12주차·82일, 기존 `a`/`b` 계정의 `summary`·`/teacher/participation`·엑셀 결과가 phase 1 이전과 동일(기존 테스트 기대값 유지로 증명).
  - 생성 → 수정 → publish → 시작 후 weeks 수정 `409 CHALLENGE_LOCKED` → archive → delete 거부.
  - `duplicate`가 draft를 만들고 주차 간격·`sourceChallengeId`·`enrollmentDeadline`이 규칙대로.
  - `GET /teacher/overview?challengeId=<draft id>`가 참여자 0명·기록 0으로 응답하고 레거시 id는 기존 값.
  - `/program`에 `challengeId`가 있고 학생 `/student/dashboard`가 레거시 챌린지로 해석된다.
- 픽스처: `docs/challenges/fixtures/*.json`을 읽어 응답 키 집합이 같은지 확인하는 테스트 1개(`Object.keys` 비교). 계약과 구현이 어긋나면 여기서 잡힌다.

## 완료 기준 (DoD)
- [ ] `npm test` 전부 통과(ffmpeg 없으면 영상 검사만 skip), `npm run build` 성공.
- [ ] 새 DB(`npm run setup`)와 기존 데이터가 있는 DB 양쪽에서 마이그레이션이 적용되고, 적용 후 기존 교사 화면 수치(완료 주차, 참여율, 엑셀)가 적용 전과 같다 — PR 본문에 적용 전/후 `/teacher/participation` 응답 요약을 붙인다.
- [ ] `grep -rn "WEEKS\b" backend/src`에 `LEGACY_WEEKS` 외 참조가 없다.
- [ ] 계약의 교사 챌린지 API(members 제외)가 모두 동작하고 픽스처 키 비교 테스트가 통과한다.
- [ ] 적재 스크립트 3종이 `challengeId`를 채우고 관련 테스트가 통과한다.
- [ ] `backend/API.md`, `backend/README.md` 갱신. 계약을 바꿨다면 `api-contract.md`·`fixtures/`도 같은 PR에서 갱신하고 PR 본문에 `계약 변경:` 명시.
