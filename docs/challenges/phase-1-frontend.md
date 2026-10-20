# Phase 1 · 프런트엔드 — mock API 계층, 교사용 챌린지 목록·편집기·양식 불러오기

브랜치 `feat/challenges-fe-1`. 범위는 `frontend/`와 이 폴더의 문서. 백엔드가 없어도 돌아가야 하므로 **mock으로 시작**한다.
계약 [api-contract.md](./api-contract.md), 예시 응답 [fixtures/](./fixtures/), 규칙 [README.md](./README.md) §4.

## 1. API 계층 (`frontend/src/challenges/`)
```
api.js        실제 클라이언트. shared.jsx의 api()를 감싸 계약의 모든 교사·학생 챌린지 함수를 export
api.mock.js   같은 함수 목록. docs/challenges/fixtures/*.json을 import해 메모리 상태로 동작(새로고침하면 초기화)
index.js      import.meta.env.VITE_CHALLENGE_API === 'mock' 이면 mock, 아니면 실제. 화면은 index.js만 import
validate.js   계약 "주차 검증 규칙"을 클라이언트에서 미리 검사해 같은 {path,message} 모양을 돌려줌(서버가 최종)
```
- 함수 이름은 계약 경로를 그대로 따른다: `listChallenges({lifecycle})`, `createChallenge(body)`, `duplicateChallenge(id,{title,startDate})`, `getChallenge(id)`, `updateChallenge(id,body)`, `publishChallenge(id)`, `archiveChallenge(id)`, `deleteChallenge(id)`. phase 2에서 members·학생 함수를 같은 파일에 추가한다.
- mock은 계약의 상태 전이·검증 오류(`INVALID_CHALLENGE` + `details`)·`CHALLENGE_LOCKED`를 **실제 서버처럼** 던진다(`ApiError` 사용). `today`는 픽스처 값(2026-10-20)을 쓰되 `window.__SELF_FIT_TODAY`가 있으면 그 값으로 덮어써 phase 계산을 테스트할 수 있게 한다.
- `duplicate`의 날짜 평행 이동 로직은 `validate.js`에 `shiftWeeks(weeks, fromStart, toStart)`로 두고 mock이 쓴다(서버와 결과가 같아야 하므로 README §4.3 규칙 그대로).
- 개발: `VITE_CHALLENGE_API=mock npm run dev --workspace frontend`.

## 2. 화면 (React 전용, 디자인 템플릿 없음 — `teacher.jsx`의 Roster/Corrections와 같은 방식)
새 파일 `frontend/src/challenges/*.jsx`, 라우팅은 `teacher.jsx`의 `TeacherApp`에 추가. 웹 상단 메뉴와 모바일 더보기에 "챌린지" 항목 추가(`shared.jsx` AppFrame).

| 경로 | 화면 | 내용 |
| --- | --- | --- |
| `/web/admin/challenges` `/mobile/admin/challenges` | `ChallengeList` | lifecycle 칩(전체/초안/진행/보관), 카드: 제목·기간·phase 칩·주차 수·참여 수(`counts`). 버튼: 새 챌린지, 양식으로 불러오기. 모바일은 읽기 전용 목록+상세 |
| `/web/admin/challenges/new` | `ChallengeEditor` (신규) | 기본 정보(제목·설명·시작일·초대 마감), 주차 편집기, 저장(=draft 생성) |
| `/web/admin/challenges/:id` | `ChallengeEditor` (수정) 또는 읽기 전용 | draft/upcoming은 편집, 시작 후에는 제목·설명·색만. 상단에 phase 칩과 publish/archive/delete 액션. 참여자 탭은 phase 2 |
| 모달 | `TemplatePicker` | 기존 챌린지 목록에서 하나 고르고 새 제목·시작일 입력 → `duplicate` → 생성된 초안 편집기로 이동 |

주차 편집기(`WeekEditor`) 요구:
- 행 추가/삭제/위아래 이동. 번호는 순서에서 자동.
- "다음 주차 자동 채우기": 앞 주차 endDate 다음 날부터 7일로 날짜 제안(월–일). 휴식 주 삽입은 날짜를 직접 조정.
- `inputType`별 필드 노출: walking(주간 일수) · check(주간 일수, 일일 설명값·단위) · count/distance(주간 합계, 일일 목표, 단위) · dumbbell(주간 일수 + 운동 목록: id·이름·반복·세트·좌우 규칙, 1–5개).
- 색: 팔레트 8개 + 직접 입력(`#RRGGBB`).
- 저장 전 `validate.js`로 검사하고 오류를 **해당 입력 옆**에 표시(`details.path` → 입력 매핑). 서버 오류도 같은 경로로 표시.
- 겹침·순서 오류는 주차 행 상단 배너.

publish 확인 모달: "게시하면 학생에게 보이고 주차 구성은 시작 전까지만 바꿀 수 있어요." delete는 draft만, archive는 published만 버튼 노출.

## 3. 공통 UI 규칙
- 기존 클래스(`card`, `btn primary`, `chip`, `tbl`, `field`, `seg`, `Modal`, `Pick`)를 재사용한다. 새 CSS는 `frontend/src/challenges.css` 하나.
- 날짜는 `YYYY-MM-DD` 문자열 그대로 `<input type="date">`. 표시 포맷은 `student-utils.js`의 `dateText`.
- 오류 표시는 `ErrorNotice`, 로딩은 `Loading`, 빈 상태는 `EmptyState`.
- 문구는 한국어 존댓말, 기존 톤("~해요").

## 4. 확인 방법
- `VITE_CHALLENGE_API=mock npm run dev --workspace frontend`로 띄워 아래 체크리스트를 수행하고, 캡처를 `output/implementation-previews/challenges-fe-1/`(git 제외)에 남긴 뒤 PR에 요약을 쓴다.
  - [ ] 목록에 픽스처 2건이 보이고 lifecycle 칩 필터가 동작
  - [ ] 새 챌린지: 주차 3개 추가 → 겹치는 날짜 입력 → 행 옆 오류 → 고치면 사라짐 → 저장 → 목록에 draft 추가
  - [ ] 양식으로 불러오기: 레거시 선택 → 시작일 2027-03-02 → 주차 12개가 평행 이동된 초안 생성, 휴식 간격 유지
  - [ ] publish → phase가 upcoming, 주차 편집 가능. `window.__SELF_FIT_TODAY='2027-03-10'`로 바꾸면 주차 편집 잠김(`CHALLENGE_LOCKED` 메시지)
  - [ ] draft 삭제, published 보관
  - [ ] 모바일(375px)에서 목록·상세가 깨지지 않음
- `npm run build` 성공. 실제 API 모드(`VITE_CHALLENGE_API` 미설정)에서는 목록이 404/빈 상태를 `ErrorNotice`로 보여주고 앱이 죽지 않아야 한다(phase 1 BE가 아직 없을 수 있음).

## 완료 기준 (DoD)
- [ ] `api.js`/`api.mock.js`/`validate.js`/`index.js` 구조 완성, 함수 이름이 계약과 1:1.
- [ ] 위 화면 4종이 mock으로 체크리스트를 통과하고 캡처 요약이 PR에 있다.
- [ ] `validate.js`의 규칙이 계약 표와 같고, 픽스처 JSON을 그대로 넣었을 때 오류 0건이다.
- [ ] `npm run build` 성공, 기존 교사·학생 화면 회귀 없음(참여 현황·정정·명단 한 번씩 열어 확인).
- [ ] 계약을 바꿔야 했다면 `api-contract.md`·`fixtures/`를 같은 PR에서 고치고 PR 본문에 `계약 변경:` 명시.
