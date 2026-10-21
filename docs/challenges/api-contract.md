# 챌린지 API 계약

Base `/api`. 인증·오류·날짜 규칙은 [backend/API.md](../../backend/API.md)와 같다: 세션 쿠키, `{error:{code,message,details?}}`, 활동 날짜는 한국 `YYYY-MM-DD`, 시각은 ISO.
이 문서의 모든 예시 응답은 [fixtures/](./fixtures/)에 JSON으로 있다. **FE mock과 BE 테스트는 같은 파일을 읽는다.**

## 공통 타입

```
ChallengeSummary = {
  id, title, description, year,
  lifecycle: 'draft'|'published'|'archived',
  phase: 'draft'|'upcoming'|'active'|'rest'|'ended'|'archived',   // 서버가 한국 날짜로 계산
  startDate, endDate, enrollmentDeadline, today,
  weekCount, sourceChallengeId: null|id,
  counts: { active, pending, declined, forced, invited },         // 참여 통계
  createdAt, updatedAt
}
Challenge = ChallengeSummary & { weeks: [Week], activityDates: ['YYYY-MM-DD', ...] }
Week = {
  id, week,                       // week: 1부터, 배열 순서
  title, startDate, endDate,
  inputType: 'walking'|'check'|'count'|'distance'|'dumbbell',
  weeklyTarget, dailyTarget: number|null, unit, dailyUnit: string|null,
  color, description,
  exercises?: [{ id, title, repetitions, targetSets, sideRule }]   // dumbbell만
}
WeekInput = Week에서 id, week를 뺀 것 (순서가 주차 번호)
Membership = {
  id, challengeId,
  user: User,                     // 교사 응답에만. 학생 응답은 user 없음
  mode: 'forced'|'invited', status: 'active'|'pending'|'declined'|'removed',
  invitedAt, respondedAt: null|ISO, invitedBy: null|{ id, name }
}
MembershipSelf = { mode, status, invitedAt, respondedAt }
```

`User`, `Record`, `Correction`, `WeekSummary`, `Summary`는 기존 API.md 정의 그대로. `Membership.user.participating` 및 참여자 미리보기의 `User.participating`은 해당 챌린지의 `active` 참여 여부다. 명단의 `targetType`·학년·반은 바꾸지 않으며, 일반 `/teacher/students`·`/auth/me`의 `User.participating`은 기존 계정 값을 유지한다. `Membership.invitedBy`는 교사 없이 이관된 레거시 참여나 초대한 교사 계정이 삭제된 경우 `null`이며, 새 교사 등록·초대 응답에는 `{id,name}`을 제공한다.

## 주차 검증 규칙 (`400 INVALID_CHALLENGE`, `details:[{path,message}]`)
- `title` 1–60자, `description` 0–500자, `startDate <= endDate`, 기간 최대 365일, `enrollmentDeadline`은 `startDate` 전날 이하가 기본이며 `endDate` 이하까지 허용.
- `weeks` 1–20개. 각 주차는 `startDate <= endDate`, 챌린지 기간 안, 배열 순서대로 날짜가 오름차순이고 **겹치지 않음**(주차 사이 빈 날짜는 휴식).
- `inputType`별:
  - `walking`: `weeklyTarget` 1–7(일), `dailyTarget` 무시(null로 저장), `unit`='일'. 구간 값(0–5)은 기존 규칙 그대로.
  - `check`: `weeklyTarget` 1–7(일), `dailyTarget` >0|null(설명용), `dailyUnit` 선택, `unit`='일'.
  - `count`: `weeklyTarget` 정수 ≥1, `dailyTarget` 정수 ≥1|null, `unit` 필수(예 '회').
  - `distance`: `weeklyTarget` > 0, `dailyTarget` >0|null, `unit` 필수(예 'km').
  - `dumbbell`: `weeklyTarget` 1–7(일), `dailyTarget` >0|null, `exercises` 1–5개, `id`는 `^[A-Z0-9_]{2,20}$`이며 챌린지 안에서 유일, `repetitions`·`targetSets` 정수 ≥1.
- `color`는 `#RRGGBB`.
- 기록 값 검증(`validateValue`)과 완료 판정은 기존 도메인 규칙을 주차 정의에 따라 적용한다.

## 교사 API (`role = teacher`)

| 메서드·경로 | 요청 | 응답 | 오류 |
| --- | --- | --- | --- |
| `GET /teacher/challenges?lifecycle=all\|draft\|published\|archived` | 기본 `all` | `{challenges:[ChallengeSummary], currentId: null\|id}` startDate 내림차순. `currentId`는 교사 "현재 챌린지"(README §5, 진행 중 우선) | |
| `POST /teacher/challenges` | `{title, description?, startDate, endDate?, enrollmentDeadline?, weeks:[WeekInput]}` `endDate` 생략 시 마지막 주차 endDate | `201 {challenge}` lifecycle=draft | `400 INVALID_CHALLENGE` |
| `POST /teacher/challenges/:id/duplicate` | `{title?, startDate}` 제목 기본 `"<원본 제목> (복사)"` | `201 {challenge}` draft, 주차 날짜는 평행 이동 | `404 CHALLENGE_NOT_FOUND` |
| `GET /teacher/challenges/:id` | | `{challenge}` | `404` |
| `PATCH /teacher/challenges/:id` | `{title?, description?, startDate?, endDate?, enrollmentDeadline?, weeks?}` | `{challenge}` | `400 INVALID_CHALLENGE`, `409 CHALLENGE_LOCKED`(시작 후 weeks/날짜 변경), `409 CHALLENGE_ARCHIVED` |
| `POST /teacher/challenges/:id/publish` | `{}` | `{challenge}` lifecycle=published | `400 INVALID_CHALLENGE`, `409 ALREADY_PUBLISHED` |
| `POST /teacher/challenges/:id/archive` | `{}` | `{challenge}` | `409 CHALLENGE_NOT_PUBLISHED` |
| `DELETE /teacher/challenges/:id` | | `{ok:true}` | `409 CHALLENGE_NOT_DRAFT` |
| `GET /teacher/challenges/:id/members?status=&mode=&grade=&classNumber=&targetType=&search=` | 필터는 모두 선택. `status` 기본 `active,pending,declined`(removed 제외) | `{members:[Membership], stats:{active,pending,declined,removed,forced,invited}}` | |
| `POST /teacher/challenges/:id/members/preview` | `{studentIds?:[id], filters?:{grade?,classNumber?,targetType?}}` 둘 중 하나 | `{students:[User & {membership:null\|MembershipSelf}]}` 아무것도 쓰지 않음 | `400 INVALID_SELECTION` |
| `POST /teacher/challenges/:id/members` | `{mode:'forced'\|'invited', studentIds?:[id], filters?:{…}}` | `201 {added:[Membership], skipped:[{userId,studentNumber,name,reason}]}` | `409 CHALLENGE_NOT_PUBLISHED`, `409 ENROLLMENT_CLOSED`(초대인데 마감 지남 / 강제인데 endDate 지남) |
| `DELETE /teacher/challenges/:id/members/:userId` | | `{ok:true}` status=removed | `404 NOT_MEMBER`, `409 HAS_RECORDS` |

`GET …/members`의 `stats`는 `grade`·`classNumber`·`targetType`·`search`로 고른 명단 범위의 모든 참여 상태를 집계한다. `status`·`mode`는 `members` 목록만 좁히며 통계에는 적용하지 않는다. `removed`는 별도 상태 수로 표시하고 `forced`·`invited` 합계에서는 제외한다.

`POST …/members` 규칙(학생 1명 단위, 전체는 한 트랜잭션):
- 참여 없음 → 생성. `forced`면 `active`, `invited`면 `pending`.
- `pending` + `forced` 요청 → mode=forced, status=active (강제 전환). `pending` + `invited` → `skipped: already_pending`.
- `declined` + `invited` → `pending`으로 재초대(invitedAt 갱신). `declined` + `forced` → forced/active.
- `active` → `skipped: already_active`. `removed` → 다시 생성 규칙 적용. 존재하지 않는 학생 → `skipped: not_found`. 교사 id → `skipped: not_student`.
- 초대 생성·재초대마다 학생 알림 `type:'invitation'` 1건(`eventKey: invitation:<membershipId>:<invitedAt>`), 강제 등록은 `type:'enrollment'` 알림 1건. 강제 등록 이벤트 키는 `enrollment:<membershipId>`이며, 같은 참여 행을 제외 후 다시 강제 등록해도 기존 이벤트 1건을 유지한다.

### 기존 교사 API에 추가되는 `challengeId`
`GET /teacher/overview`, `/teacher/participation`, `/teacher/export`, `/teacher/corrections`, `/teacher/students/:id`에 `challengeId` 쿼리를 추가한다.
생략하면 "현재 챌린지"(README §5). 응답에 `challenge: ChallengeSummary`를 포함한다. 분모·`participating` 표기는 그 챌린지의 `active` 참여자다.
`/teacher/students`(명단)는 계정 단위다. `participating`(및 `participating` 필터)은 `challengeId`로 준 챌린지, 없으면 교사의 현재 챌린지의 `active` 참여 여부다. `User.participating` 컬럼은 제거됐고, 챌린지 문맥이 없는 계정 응답(`/auth/me` 등)의 `participating`은 `null`이다. 학생 생성·명단 등록은 어떤 챌린지에도 참여시키지 않는다.

## 학생 API (`role = student`)

| 메서드·경로 | 요청 | 응답 | 오류 |
| --- | --- | --- | --- |
| `GET /student/challenges` | | `{current: null\|{challenge:ChallengeSummary, membership:MembershipSelf}, challenges:[{challenge, membership}], invitations:[{challenge, membership}], closedInvitations:[{challenge, membership}], archived:[{challenge, membership}]}` `challenges`는 게시 챌린지의 active 참여, `invitations`는 `pending`이고 마감 전인 것만, `closedInvitations`는 마감은 지났지만 아직 종료 전(오늘 ≤ endDate)인 `pending` 초대, `archived`는 active 참여였던 보관 챌린지 | |
| `POST /student/challenges/:id/accept` | `{}` | `{membership:MembershipSelf}` status=active | `404 NO_INVITATION`, `409 INVITATION_CLOSED` |
| `POST /student/challenges/:id/decline` | `{}` | `{membership}` status=declined | `404 NO_INVITATION` |
| `GET /student/challenges/:id` | | `{challenge}` (published, 또는 active 참여였던 archived) | `404` |
| `GET /student/challenges/:id/dashboard` | | `{user, challenge, membership, summary, records, unreadCount}` 기존 `/student/dashboard`에서 `program` → `challenge` | `403 NOT_MEMBER`(active 아님) |
| `GET /student/challenges/:id/records` | | `{records, summary}` | `403 NOT_MEMBER` |
| `GET /student/challenges/:id/records/:date` | | 기존 `/student/records/:date`와 동일 | |
| `PUT /student/challenges/:id/records/:date` | 기존과 동일 | 기존과 동일 | 기존 코드 + `403 NOT_MEMBER` |
| `POST /student/challenges/:id/records/:date/corrections` | 기존과 동일 | | |
| `POST /student/challenges/:id/records/:date/attachments`, `DELETE …/attachments/:aid` | 기존과 동일 | | |
| `GET /student/corrections`, `/student/notifications*`, `/student/settings*`, `/student/push-subscriptions` | 변경 없음(계정 단위). `Correction`에 `challengeId` 필드 추가 | | |

레거시 조회·기록 경로 `GET /student/dashboard`, `/student/records*`, `/program`은 "현재 챌린지"로 해석한다. phase 3부터 이 경로와 `POST /student/enroll`은 응답 헤더 `Deprecation: true`를 붙이며 다음 릴리스에서 제거한다. 참여 신청 호환 경로도 아래 규칙으로 유지한다.
`POST /student/enroll {}`은 기존 응답 `{user:User}`를 유지한다. 이 호환 경로는 현재 챌린지 resolver와 별개로, 게시된 챌린지의 `mode=invited,status=pending` 중 오늘이 `enrollmentDeadline` 이하인 초대를 찾는다. 수락 가능한 초대가 0개면 기존 `403 ENROLLMENT_CLOSED`, 1개면 그 초대를 수락하고 해당 챌린지 참여가 반영된 `user`를 반환한다. 2개 이상이면 아무 초대도 변경하지 않고 `409 INVITATION_SELECTION_REQUIRED`, `details:{challengeIds:[id,...]}`를 반환한다. 클라이언트는 초대 선택을 안내하고 `POST /student/challenges/:id/accept`로 명시적으로 수락한다.
`/program` 응답에는 `challengeId`가 추가된다.

학생 목록 응답의 `current.challenge`, `challenges[].challenge`, `invitations[].challenge`는 `ChallengeSummary`다. 학생 상세 `GET /student/challenges/:id`와 학생 대시보드의 `challenge`는 `weeks`·`activityDates`를 포함하는 `Challenge`다. 게시된 챌린지 상세는 초대 미수락 학생도 볼 수 있지만, 대시보드·기록·정정·첨부 변경은 해당 챌린지의 `active` 참여를 요구한다.

알림 `Notification`에 `data: null|{challengeId, membershipId}`가 추가된다(초대·등록 알림만 값이 있음).

## 오류 코드 모음
| 코드 | 상태 | 뜻 |
| --- | --- | --- |
| `CHALLENGE_NOT_FOUND` | 404 | 없는 챌린지, 또는 학생이 draft를 조회 |
| `INVALID_CHALLENGE` | 400 | 검증 실패. `details:[{path:'weeks[2].endDate', message}]` |
| `CHALLENGE_LOCKED` | 409 | 시작 후 주차/날짜 수정 |
| `CHALLENGE_NOT_DRAFT` / `ALREADY_PUBLISHED` / `CHALLENGE_NOT_PUBLISHED` / `CHALLENGE_ARCHIVED` | 409 | 상태 전이 위반. 학생이 보관 챌린지의 기록·정정·첨부를 바꾸려 할 때, 교사가 보관 챌린지 기록의 정정 요청을 승인하려 할 때도 `CHALLENGE_ARCHIVED`(읽기와 반려는 허용) |
| `INVALID_SELECTION` | 400 | `studentIds`도 `filters`도 없거나 둘 다 있음, 100,000자 초과 |
| `ENROLLMENT_CLOSED` | 409 | 초대 마감/종료 후 등록 시도 |
| `INVITATION_CLOSED` | 409 | 학생이 마감 후 수락 |
| `NO_INVITATION` | 404 | 대기 중 초대 없음 |
| `INVITATION_SELECTION_REQUIRED` | 409 | 호환 enroll에 수락 가능한 초대가 여러 개라 선택 필요. `details:{challengeIds:[id,...]}` |
| `NOT_MEMBER` | 403 | active 참여자가 아닌 학생의 기록 접근 |
| `HAS_RECORDS` | 409 | 기록이 있는 참여자 제외 |

## 예시

### 챌린지 생성 요청
```json
{
  "title": "2027 봄 챌린지",
  "description": "3월 한 달, 매주 운동 하나",
  "startDate": "2027-03-02",
  "enrollmentDeadline": "2027-03-01",
  "weeks": [
    { "title": "만보 걷기", "startDate": "2027-03-02", "endDate": "2027-03-08", "inputType": "walking", "weeklyTarget": 5, "dailyTarget": null, "unit": "일", "dailyUnit": "보", "color": "#E07A2E", "description": "하루 10,000보 이상, 기준을 충족한 5일" },
    { "title": "줄넘기", "startDate": "2027-03-09", "endDate": "2027-03-15", "inputType": "count", "weeklyTarget": 1000, "dailyTarget": 200, "unit": "회", "dailyUnit": "회", "color": "#2F7FD8", "description": "하루 200회, 주간 합계 1,000회 이상" },
    { "title": "덤벨 운동", "startDate": "2027-03-16", "endDate": "2027-03-20", "inputType": "dumbbell", "weeklyTarget": 3, "dailyTarget": 3, "unit": "일", "dailyUnit": "종목", "color": "#5A6372", "description": "세 종목 10회×2세트, 3일 이상",
      "exercises": [
        { "id": "CURL", "title": "덤벨 컬", "repetitions": 10, "targetSets": 2, "sideRule": "좌우 각각 10회 = 1세트" },
        { "id": "SQUAT", "title": "덤벨 스쿼트", "repetitions": 10, "targetSets": 2, "sideRule": "전체 10회 = 1세트" },
        { "id": "ROW", "title": "덤벨 로우", "repetitions": 10, "targetSets": 2, "sideRule": "좌우 각각 10회 = 1세트" }
      ] }
  ]
}
```
응답은 [fixtures/challenge-detail.json](./fixtures/challenge-detail.json). 목록·참여자·학생 화면 예시는 같은 폴더.

### 덤벨 기록 값
주차의 `exercises[].id`를 키로 하는 객체. `{ "CURL": 2, "SQUAT": 2, "ROW": null }`처럼 **정확히 그 키들만**, 미입력은 `null`. 레거시 챌린지는 `D12_CURL`/`D12_SQUAT`/`D12_ROW`를 그대로 쓴다.
