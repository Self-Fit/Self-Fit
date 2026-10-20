# Phase 2 · 프런트엔드 — 교사 인원 선택, 학생 초대함·챌린지 전환

브랜치 `feat/challenges-fe-2` (phase 1 FE가 main에 들어간 뒤). 범위 `frontend/`, 이 폴더 문서. 여전히 mock으로 개발한다.

## 1. API 계층 추가 (`frontend/src/challenges/api*.js`)
교사: `listMembers(id,filters)`, `previewMembers(id,selection)`, `addMembers(id,{mode,studentIds|filters})`, `removeMember(id,userId)`.
학생: `listMyChallenges()`, `acceptInvitation(id)`, `declineInvitation(id)`, `getStudentChallenge(id)`, `getChallengeDashboard(id)`, 기록 함수는 phase 3에서 기존 `api()` 호출을 경로만 바꿔 쓴다.
mock은 `members.json`, `members-add-response.json`, `student-challenges.json`을 초기 상태로 쓰고 계약의 "`POST …/members` 규칙" 표와 수락 마감 규칙을 구현한다. `listMembers`의 `stats`는 상태에서 계산.

## 2. 교사 화면
| 경로 | 화면 | 내용 |
| --- | --- | --- |
| `/web/admin/challenges/:id/members` | `MemberManager` | 상단 통계(active/pending/declined, forced/invited). 참여자 표: 이름·학번·학년반·구분·mode 칩·status 칩·초대일·응답일, 행 액션(재초대 / 강제 전환 / 제외). 필터: status, mode, 학년, 반, 검색 |
| 모달 | `AddMembersDialog` | 1단계 대상 선택: 학년/반/대상구분 필터 **또는** 명단에서 체크(둘 중 하나만, 전환 시 초기화). "미리보기"로 `previewMembers` 호출 → 이미 참여 중/대기 중인 학생은 회색 표시. 2단계 방식 선택: 강제 등록(즉시 참여, 거절 불가) / 초대(수락 필요, 마감일 표시). 3단계 결과: `added` 수와 `skipped` 사유별 목록 |
| 모바일 `/mobile/admin/challenges/:id` | 읽기 전용 참여자 목록 + 통계. 등록·초대는 PC 안내 문구 |

- 초대 마감이 지난 published 챌린지에서는 "초대" 버튼을 비활성화하고 사유를 보여준다. endDate가 지나면 "강제 등록"도 비활성화.
- 제외는 확인 모달, 실패(`HAS_RECORDS`)는 `ErrorNotice`.

## 3. 학생 화면
| 경로 | 화면 | 내용 |
| --- | --- | --- |
| `/web/challenges`, `/mobile/challenges` | `MyChallenges` | 초대 카드(제목·기간·주차 수·마감일·수락/거절), 참여 중 목록(phase 칩), 지난 챌린지 |
| 홈 상단(기존 HomeScreen) | 초대 배너 | `invitations.length>0`이면 "새 챌린지 초대가 n건 있어요" 배너 → `MyChallenges`. 템플릿 화면이므로 `bindStudentChrome` 다음에 DOM으로 삽입 |
| 알림 화면 | type `invitation`/`enrollment` 행 | 클릭 시 `MyChallenges`로 이동 |
| 헤더/마이 | 챌린지 전환 | `challenges`가 2개 이상이면 현재 챌린지 이름 옆 전환 메뉴. 선택은 `localStorage['self-fit.challengeId']`에 저장(phase 3에서 경로에 반영) |

- 수락 성공 후 `MyChallenges`를 다시 불러오고 "참여가 확정됐어요" 피드백(`runtime-feedback`). 거절은 확인 모달.
- 마감이 지난 초대는 카드에 "수락 기간이 지났어요"로 비활성.

## 4. 확인 방법 (mock)
- [ ] 필터로 1학년 선택 → 미리보기 n명 → 초대 → 결과 모달에 added/skipped 사유
- [ ] 명단 체크 3명 → 강제 등록 → 표에서 forced/active
- [ ] pending 학생 재초대·강제 전환, declined 학생 재초대, 기록 있는 학생 제외 실패 메시지
- [ ] 학생: 초대 카드 수락 → 참여 중 목록으로 이동, 거절 → 사라짐, 마감 지난 초대 비활성
- [ ] 홈 배너·알림 행에서 `MyChallenges`로 이동
- [ ] 모바일 375px 레이아웃
캡처는 `output/implementation-previews/challenges-fe-2/`.

## 완료 기준 (DoD)
- [ ] 위 화면과 mock 동작이 체크리스트를 통과, `npm run build` 성공.
- [ ] 교사 phase 1 화면에 "참여자" 탭/링크가 연결됐다.
- [ ] 계약 변경 시 문서·픽스처 동반 수정.
