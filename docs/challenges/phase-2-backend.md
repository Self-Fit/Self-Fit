# Phase 2 · 백엔드 — 참여자(강제/초대), 학생 수락·거절, 알림

브랜치 `feat/challenges-be-2` (phase 1 BE가 main에 들어간 뒤). 범위 `backend/`, 이 폴더 문서.

## 1. 참여자 서비스 (`backend/src/memberships.js`)
- `selectStudents(db,{studentIds?,filters?})`: 계약 `members/preview`와 동일한 규칙으로 대상 학생을 고른다. 둘 다 없거나 둘 다 있으면 `400 INVALID_SELECTION`. `filters`는 `parseFilters`(grade/classNumber/targetType)를 재사용한다.
- `addMembers(db,{challenge,teacher,mode,students})`: 계약 "`POST …/members` 규칙" 표를 그대로 구현. **한 트랜잭션**(Serializable), 학생마다 `added`/`skipped` 분류. `enrollmentDeadline`/`endDate` 검사는 트랜잭션 안에서 한국 날짜로.
- `removeMember`: 그 챌린지에 기록이 있으면 `409 HAS_RECORDS`, 아니면 `status='removed'`(행 삭제 아님).
- 학생용 `acceptInvitation`, `declineInvitation`: `pending`만, 수락은 `enrollmentDeadline` 포함까지. 동시 요청은 `updateMany({where:{status:'pending'}})` count로 막는다.

## 2. 라우터
- 교사: 계약의 `members`, `members/preview`, `DELETE members/:userId`를 `challengeRouter`에 추가.
- 학생: `backend/src/student-challenges.js`로 분리해 `/student/challenges`, `/:id/accept`, `/:id/decline`, `/:id`, `/:id/dashboard`, `/:id/records*`, `/:id/records/:date/corrections`, 첨부 경로. 기존 `studentRouter`의 핸들러를 "챌린지를 인자로 받는 함수"로 뽑아 레거시 경로와 공유한다(코드 중복 금지).
- `requireMember(status='active')` 미들웨어: 참여가 아니면 `403 NOT_MEMBER`. `GET /student/challenges/:id`는 published면 참여 여부와 무관하게 허용(초대 카드에서 상세 보기).
- `POST /student/enroll` 호환: 현재 챌린지에 `pending`이 있으면 accept와 동일, 없으면 기존 `403 ENROLLMENT_CLOSED`.

## 3. 알림
- `Notification.data` 사용. 초대: `type:'invitation'`, `eventKey:invitation:<membershipId>:<invitedAt ISO>`, 제목 "새 챌린지에 초대됐어요", 본문에 챌린지 제목과 마감일. 강제 등록: `type:'enrollment'`, `eventKey:enrollment:<membershipId>`.
- 푸시 전달(`deliverPendingPush`)은 두 타입 모두 운동 독려 게이트를 거치지 않는다(정정 결과와 같은 취급). 서비스 워커 클릭 URL은 `data.challengeId`가 있으면 `/mobile/challenges`로.
- 독려 스케줄러는 챌린지별 `active` 참여자만 대상으로 한다(`reminderDecision(weeks,user,records,date)`에 그 챌린지 기록만 전달).

## 4. 테스트
- `integration.test.js` 하위 테스트:
  - 강제 등록 → 즉시 active, 알림 1건, 중복 요청은 `skipped: already_active`.
  - 초대 → pending, 학생 `GET /student/challenges`의 `invitations`에 보임 → accept → active, 기록 입력 가능(`PUT /student/challenges/:id/records/:date`, 모의 시계로 활동일 설정) → 레거시 `/student/dashboard`가 그 챌린지를 현재로 해석.
  - 거절 → declined → 재초대 → pending → 강제 → forced/active.
  - 마감 후 accept `409 INVITATION_CLOSED`, 마감 후 초대 `409 ENROLLMENT_CLOSED`, endDate 후 강제 `409`.
  - 비참여 학생의 `/student/challenges/:id/records/...` → `403 NOT_MEMBER`.
  - 기록 있는 참여자 제외 `409 HAS_RECORDS`, 없는 참여자 제외 → removed, 목록 기본 필터에서 숨김.
  - 분모 검증: `/teacher/participation?challengeId=`가 pending/declined를 제외한다.
  - 픽스처 키 비교(`members.json`, `members-add-response.json`, `student-challenges.json`).

## 완료 기준 (DoD)
- [ ] 계약의 교사 members 3개·학생 API 전부 구현, `npm test`·`npm run build` 통과.
- [ ] 알림 2종과 푸시 게이트 예외가 테스트로 증명된다.
- [ ] 레거시 학생 경로가 계속 동작한다(기존 통합 테스트 변경 없음).
- [ ] `backend/API.md` 갱신, 계약 변경 시 문서·픽스처 동반 수정.
