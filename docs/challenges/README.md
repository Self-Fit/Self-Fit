# 챌린지 기능 (새 챌린지 등록 · 재활용 · 인원 선택 · 강제 참여/초대)

이 폴더는 "하나뿐인 2026년 12주 프로그램"을 **여러 개의 챌린지**로 일반화하는 작업의 기준 문서입니다.
프런트엔드와 백엔드는 이 문서와 [api-contract.md](./api-contract.md)만 보고 **서로 기다리지 않고** 작업한 뒤,
마지막 phase에서 붙입니다. 계약을 바꿔야 하면 코드보다 먼저 이 폴더의 문서와 `fixtures/`를 고치고 PR에 명시합니다.

| 문서 | 담당 | 내용 |
| --- | --- | --- |
| [README.md](./README.md) | 공통 | 목표, 용어, 데이터 모델, 상태 규칙, phase 분할, 병렬 작업 규칙 |
| [api-contract.md](./api-contract.md) | 공통(고정) | 엔드포인트·요청/응답·오류 코드. FE는 이것만 보고 mock을 만든다 |
| [fixtures/](./fixtures/) | 공통(고정) | 계약과 1:1인 예시 응답 JSON. FE mock과 BE 테스트가 같이 쓴다 |
| [phase-1-backend.md](./phase-1-backend.md) | BE | 스키마·마이그레이션·도메인 일반화·챌린지 CRUD/재활용 |
| [phase-1-frontend.md](./phase-1-frontend.md) | FE | mock API 계층, 교사용 챌린지 목록/편집기/양식 불러오기 |
| [phase-2-backend.md](./phase-2-backend.md) | BE | 참여자(강제/초대) API, 학생 수락/거절, 알림·독려 범위 |
| [phase-2-frontend.md](./phase-2-frontend.md) | FE | 교사 인원 선택 화면, 학생 초대함·챌린지 전환 |
| [phase-3-integration.md](./phase-3-integration.md) | 공통 | mock → 실제 API 전환, 기존 화면 챌린지 범위화, 레거시 정리, QA |

## 1. 목표와 범위

- 교사가 **새 챌린지를 등록**한다: 제목·설명·기간·주차(운동) 구성.
- 기존 챌린지를 **양식으로 불러와 재활용**한다: 주차 구성을 복사한 초안을 만들고 날짜만 새 시작일 기준으로 옮긴다.
- 챌린지별로 **참여 인원을 선택**한다: 학년·반·대상 구분 필터 또는 개별 선택.
- **강제 참여**: 교사가 등록하면 즉시 참여 확정. **초대**: 학생이 수락해야 참여, 거절 가능.
- 기존 2026년 프로그램은 코드 수정 없이 "챌린지 1번"으로 **그대로 이관**되고 집계 결과가 바뀌지 않는다.

범위 밖(이번 작업에서 하지 않음): 주차 단위 개별 참여, 학생 간 랭킹, 챌린지 삭제 복구, 푸시 외 외부 알림, 디자인 시안 신규 제작(React 화면으로 구현).

## 2. 용어

| 용어 | 의미 |
| --- | --- |
| 챌린지 `Challenge` | 기간·주차 목록·참여자 집합을 갖는 운영 단위. 지금의 "2026 Self Fit 12주"가 첫 챌린지 |
| 주차 `ChallengeWeek` | 챌린지 안의 한 운동 구간. 현재 `backend/src/domain/index.js`의 `WEEKS` 한 항목과 같은 필드 |
| 참여 `ChallengeMembership` | 학생–챌린지 관계. `mode`(강제/초대)와 `status`(확정/대기/거절/제외) |
| 양식으로 불러오기 | 기존 챌린지의 제목·설명·주차 구성을 복사해 **초안(draft)** 챌린지를 만드는 것 |
| 현재 챌린지 | 레거시 경로(`/student/dashboard` 등)가 가리키는 챌린지. 해석 규칙은 §5 |

## 3. 데이터 모델 (Prisma 기준)

```prisma
model Challenge {
  id                 String   @id @default(uuid())
  title              String
  description        String   @default("")
  year               Int
  lifecycle          String   @default("draft") // draft | published | archived
  startDate          String                     // 한국 날짜 YYYY-MM-DD
  endDate            String
  enrollmentDeadline String                     // 초대 수락 마감(포함). 기본값 startDate 전날
  sourceChallengeId  String?                    // 양식으로 불러온 원본
  createdById        String?                   // 레거시 이관 행은 NULL 가능
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  weeks              ChallengeWeek[]
  memberships        ChallengeMembership[]
  records            DailyRecord[]
}
model ChallengeWeek {
  id           String  @id @default(uuid())
  challengeId  String
  week         Int                 // 1부터, 배열 순서 = 주차 번호
  title        String
  startDate    String
  endDate      String
  inputType    String              // walking | check | count | distance | dumbbell
  weeklyTarget Float
  dailyTarget  Float?
  unit         String
  dailyUnit    String?
  color        String              // #RRGGBB
  description  String  @default("")
  exercises    Json?               // dumbbell 전용 [{id,title,repetitions,targetSets,sideRule}]
  @@unique([challengeId, week])
}
model ChallengeMembership {
  id          String    @id @default(uuid())
  challengeId String
  userId      String
  mode        String                 // forced | invited
  status      String                 // active | pending | declined | removed
  invitedById String?
  invitedAt   DateTime  @default(now())
  respondedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@unique([challengeId, userId])
}
// DailyRecord: challengeId String 추가, @@unique([challengeId, userId, date])
// Notification: data Json? 추가(초대 알림의 {challengeId, membershipId})
```

DB 제약(마이그레이션 SQL에 CHECK로 넣는다): `lifecycle`, `inputType`, `mode`, `status` 값 집합, `startDate <= endDate`, 주차는 챌린지 기간 안.

`User.participating`/`User.targetType`은 **당분간 유지**한다. `targetType`은 명단의 기본 구분(필수/선택)으로 인원 선택 필터에 쓰고,
`participating`은 phase 3에서 "현재 챌린지 active 참여 여부"로 재해석하거나 제거한다(phase 3 결정 항목).

## 4. 상태 규칙

### 4.1 챌린지 `lifecycle`과 `phase`
- `draft` → `published` → `archived`. 역방향 없음. `draft`는 학생에게 보이지 않는다.
- `phase`는 저장하지 않고 **한국 날짜로 계산**한다(기존 `programDto().status`와 같은 규칙):
  `draft` / `archived`는 그대로, published면 `upcoming`(오늘 < startDate) · `active`(어느 주차 안) · `rest`(주차 사이) · `ended`(오늘 > endDate).
- 주차 구성(`weeks`)은 `draft`이거나 **아직 시작 전**(`upcoming`)일 때만 바꿀 수 있다. 시작 후에는 제목·설명·색만 수정 가능 → 그 외는 `409 CHALLENGE_LOCKED`.
- `publish`는 주차 검증을 통과해야 하고, 통과하면 학생 초대·강제 등록이 가능해진다.
- `delete`는 `draft`만. 그 외는 `archive`.

### 4.2 참여 `mode` × `status`
| 상황 | mode | status | 비고 |
| --- | --- | --- | --- |
| 교사가 강제 등록 | forced | active | 즉시 확정, 학생이 거절 불가 |
| 교사가 초대 | invited | pending | 학생 홈과 알림에 초대 카드 |
| 학생 수락 | invited | active | `enrollmentDeadline`(포함)까지만. 이후 `409 INVITATION_CLOSED` |
| 학생 거절 | invited | declined | 교사가 다시 초대하면 pending으로 복귀, 강제 등록하면 forced/active |
| 교사 제외 | (유지) | removed | 그 챌린지에 기록이 있으면 불가 `409 HAS_RECORDS`(기존 삭제 정책과 동일) |

- **집계 분모와 기록 입력 권한은 `status = active`만** 인정한다(기존 `participating=true`와 같은 역할).
- 강제 등록은 `endDate`까지 언제든 가능. 초대 발송도 `enrollmentDeadline`까지.
- 한 학생이 기간이 겹치는 여러 챌린지에 참여할 수 있다. 기록은 `(challengeId, userId, date)`로 분리된다.

### 4.3 양식으로 불러오기(재활용)
- `POST /teacher/challenges/:id/duplicate { title?, startDate }` → 새 `draft`.
- 주차 날짜는 **원본 startDate와의 간격을 유지**해 평행 이동한다(주차 사이 휴식 기간도 그대로). `endDate`는 마지막 주차의 endDate, `enrollmentDeadline`은 새 startDate 전날.
- 참여자·기록은 복사하지 않는다. `sourceChallengeId`에 원본을 남긴다.

## 5. "현재 챌린지" 해석(레거시 호환)
phase 3 전까지 기존 경로는 그대로 동작해야 한다. 서버가 요청마다 아래로 해석한다.
- 학생: 내 `active` 참여 중 phase가 `active` → `upcoming` → `rest` 순으로 우선, 없으면 가장 최근 `ended`. 없으면 `null`(기존 "미참여" 화면).
- 교사: `published` 중 startDate가 가장 늦은 것. `challengeId` 쿼리로 명시하면 그것.
- `/program`은 교사·학생 공통으로 "현재 챌린지"를 돌려주되 응답 모양은 기존과 같다(`weeks`, `activityDates`, `status`…) + `challengeId`.

## 6. 기존 코드에서 바뀐 접점 (phase 3 완료 기준 최종 상태)

| 파일 | 이전 | 지금 |
| --- | --- | --- |
| `backend/src/domain/index.js` | `WEEKS` 상수를 모든 함수가 직접 참조 | 함수가 `weeks` 배열을 받음. `LEGACY_WEEKS`는 도메인 모듈·마이그레이션·적재 스크립트·테스트에서만 사용 |
| `backend/src/dto.js` `programDto` | 인자 없음 | `programDto(challenge)` (레거시 `/program`·`/student/dashboard`용) |
| `backend/src/student.js`, `student-challenges.js` | `/student/*`가 사용자 기록 전체 | `/student/challenges/:id/*`가 기준. 레거시 경로는 현재 챌린지로 해석하고 `Deprecation: true`를 붙임(다음 릴리스에서 제거) |
| `backend/src/teacher.js`, `participation.js`, `export.js` | 전교생·전체 기록 | `challengeId`로 범위 제한, 분모는 `active` 참여자. `/teacher/students?challengeId=`는 그 챌린지 기준 참여 여부 |
| `User.participating` | 참여 여부 | 읽기 전용 레거시 값. 학생 생성·명단 등록·수정에서 더 이상 쓰지 않음(제거는 별도 마이그레이션 결정) |
| `backend/src/notifications.js` | `reminder:<user>:<date>` | `reminder:<challengeId>:<user>:<date>`만 생성, 챌린지별 주차로 판정 |
| `backend/scripts/import-*.js` | DailyRecord에 challengeId 없음 | 레거시 챌린지 id로 적재 |
| `frontend/src/student.jsx` 등 | `/student/dashboard` 하나 | `GET /student/challenges`로 고른 챌린지의 `/student/challenges/:id/dashboard`·`records` 사용. 전환 메뉴(내 챌린지·마이) 선택이 화면에 반영 |
| `frontend/src/teacher.jsx`, `participation.jsx` | 챌린지 개념 없음 | 챌린지 관리 메뉴 + 상단 `ChallengeSelector`(`?challengeId=`). 운영 일정은 고른 챌린지의 주차를 보여주고 `/program`을 쓰지 않음 |
| `tests/browser-fixture.mjs` | 2026 프로그램만 | 레거시 기록 + 오늘 기준 진행 중·예정 챌린지, 강제 등록·초대 시드 |

## 7. Phase 분할과 완료 기준

```
phase 1 BE ──┐                      ┌── phase 3 통합 (BE+FE 함께)
phase 1 FE ──┼── phase 2 BE ────────┤
             └── phase 2 FE ────────┘
```
- phase 1 BE와 phase 1 FE는 **동시에** 시작한다. FE는 `fixtures/`로 mock을 만들어 서버 없이 개발한다.
- phase 2는 각자 phase 1이 main에 들어간 뒤 시작한다(BE는 BE 1 위에, FE는 FE 1 위에).
- phase 3는 BE 2·FE 2가 모두 main에 들어온 뒤 한 브랜치에서 한다.

각 phase 문서 끝의 **완료 기준(DoD)** 을 모두 만족해야 PR을 올린다. 공통 기준:
- `npm test` 통과(통합 테스트 포함), `npm run build` 성공.
- 계약 변경이 있으면 `api-contract.md`와 `fixtures/`를 같은 PR에서 갱신하고 PR 본문 맨 위에 `계약 변경:` 줄을 쓴다.
- 기존 2026 챌린지의 집계(완료 주차 수, 주차별 합계, 참여율, 엑셀)가 작업 전과 같다. BE는 이를 테스트로 증명한다.

## 8. 병렬 작업 규칙
- 브랜치: `feat/challenges-be-1`, `feat/challenges-fe-1`, `feat/challenges-be-2`, `feat/challenges-fe-2`, `feat/challenges-integration`. main 직접 push 금지, PR로.
- 파일 경계: BE는 `backend/`, `scripts/`, `docs/challenges/`만. FE는 `frontend/`, `docs/challenges/`만. 같은 phase에서 상대 영역을 건드리지 않는다.
- FE mock은 `frontend/src/challenges/api.mock.js`에, 실제 클라이언트는 `api.js`에 둔다. 화면은 둘 중 무엇이 꽂혀도 동작해야 한다(`VITE_CHALLENGE_API=mock`).
- 날짜는 전부 한국 날짜 문자열 `YYYY-MM-DD`, 시각은 ISO. 클라이언트가 "오늘"을 정하지 않고 서버 응답의 `today`를 쓴다.
- 오류는 기존 모양 `{error:{code,message,details?}}`를 유지한다.
- 코드 스타일·언어·테스트 방식은 루트 [AGENTS.md](../../AGENTS.md)를 따른다.
