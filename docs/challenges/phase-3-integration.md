# Phase 3 · 통합 — 실제 API 연결, 기존 화면 챌린지 범위화, 레거시 정리, QA

브랜치 `feat/challenges-integration`. BE 2·FE 2가 main에 들어온 뒤 **BE·FE가 같은 브랜치에서** 작업한다. 범위 전체.

## 1. 연결
- `VITE_CHALLENGE_API` 기본값을 실제 API로. mock은 `npm run dev:mock`(frontend `package.json` 스크립트)로만 남긴다.
- FE 함수 ↔ 실제 엔드포인트를 하나씩 호출해 픽스처와 키가 같은지 확인(브라우저 콘솔이 아니라 `tests/browser-fixture.mjs`를 확장해 챌린지·참여자·초대를 시드하는 QA 환경을 만든다).

## 2. 기존 화면을 챌린지 범위로
교사
- 헤더에 `ChallengeSelector`(published 챌린지 목록, 기본 "현재"). 선택값은 `?challengeId=`로 경로에 들어가고 참여 현황·참여율·정정 요청함·학생 상세·엑셀 내보내기가 이를 전달한다.
- 참여 현황의 "참여자/비참여" 표기와 필터를 `membership.status` 기준으로 바꾼다(`participating` 사용처 `teacher.jsx` 8곳).
- 운영 일정(`/admin/schedule`)은 선택된 챌린지의 주차를 보여준다(`/program` 의존 제거).
학생
- `StudentApp`이 `GET /student/challenges`로 현재 챌린지를 정한 뒤 `/student/challenges/:id/dashboard`·records 경로를 쓴다. 전환 메뉴 선택을 경로/상태에 반영.
- 홈 템플릿의 "12주", "/ 12주" 고정 문구를 `challenge.weekCount`로(`student-screens.jsx` 2곳, `student-record.jsx` 2곳). 로드맵의 휴식 라벨("수학여행 주", "방학")은 주차 사이 간격이 있을 때 "쉬는 기간"으로 일반화.
- 참여하지 않은 학생의 홈: 초대가 있으면 초대 카드, 없으면 기존 미참여 안내.
- 덤벨 입력은 `week.exercises`만 사용(이미 그렇게 되어 있음, `dumbbell-values.js` 확인).

## 3. 레거시 정리
- 레거시 경로(`/student/dashboard`, `/student/records*`, `/student/enroll`, `/program`)는 한 릴리스 동안 유지하고 응답 헤더 `Deprecation: true`를 붙인다. 다음 릴리스에서 제거.
- `User.participating`은 "현재 챌린지 active 참여"의 캐시로 쓰지 않고 **읽기 전용으로 두되 더 이상 갱신하지 않는다**. 명단 화면의 "참여" 열은 선택된 챌린지의 membership으로 바꾼다. 제거는 별도 마이그레이션(결정 필요).
- `LEGACY_WEEKS`는 마이그레이션·적재 스크립트·테스트에서만 쓰고, 그 외 참조가 없는지 `grep`으로 확인.
- 알림 스케줄러 키 전환이 끝났는지 확인(새 키 형식만 생성).

## 4. 실제 데이터 적용 절차
1. 운영 DB `pg_dump` 백업(`backend/scripts/import-revised-participation.js`의 `before-revision.dump`/`backup-manifest.json` 방식과 동일하게 `.local/`에 남긴다).
2. `npm run db:deploy --workspace backend`로 마이그레이션 적용.
3. 적용 전/후 `/teacher/participation`, `/teacher/export` 요약(완료 주차 합, 참여자 수, 주차별 완수율)을 비교해 동일함을 확인하고 PR 본문에 기록.
4. 교사 계정으로 레거시 챌린지가 `published/ended`로 보이고 참여자 수가 기존 `participating=true` 수와 같은지 확인.

## 5. QA 체크리스트 (브라우저, 교사 1 + 학생 2 계정)
- [ ] 새 챌린지 생성 → 양식 불러오기 → publish → 학생 A 강제 등록, 학생 B 초대
- [ ] 학생 B 홈 배너 → 수락 → 참여 중. 학생 A는 초대 카드 없이 바로 참여
- [ ] 모의 시계 없이 가능한 범위: upcoming 상태의 "예정" 화면, 레거시 챌린지 전환 후 기록·정정 조회
- [ ] 교사 참여율·참여 현황·엑셀이 선택된 챌린지로 바뀜, 정정 요청함이 챌린지 필터를 가짐
- [ ] 알림: 초대/등록 알림 2종 표시, 클릭 이동
- [ ] 모바일 전 화면(교사 더보기 → 챌린지, 학생 챌린지 전환)
- [ ] `npm test`, `npm run build`, `node --env-file=backend/.env tests/browser-fixture.mjs`

## 6. 문서
- `backend/API.md`: 챌린지 절 완성, 레거시 경로 Deprecation 표기.
- 루트 `README.md`: "동작 범위"에 챌린지 등록·재활용·인원 선택·강제/초대 추가, 실행 안내에 `dev:mock`.
- 이 폴더 README의 §6 표를 최종 상태로 갱신.

## 완료 기준 (DoD)
- [ ] mock 없이 전 기능이 실제 API로 동작, QA 체크리스트 통과, 캡처 요약 PR 첨부.
- [ ] 레거시 데이터 적용 전/후 수치 동일 기록.
- [ ] 테스트·빌드·브라우저 픽스처 통과, 문서 3종 갱신.
