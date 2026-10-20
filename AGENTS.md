# AGENTS.md — Self-Fit 작업 안내 (Codex · Claude 공통)

이 저장소에서 에이전트가 작업할 때 지켜야 할 규칙입니다. 사람 팀원도 같은 규칙을 따릅니다.

## 1. 프로젝트 한눈에
- 학생 운동 기록·교사 참여 관리 앱. `frontend/`(React 19 + Vite, 디자인 템플릿을 innerHTML로 렌더한 뒤 DOM을 직접 바인딩), `backend/`(Express 5 + Prisma 6 + PostgreSQL), `scripts/`(로컬 DB·개발 서버), `docs/`(디자인 시안, 기능 문서).
- 날짜는 **한국 날짜 문자열 `YYYY-MM-DD`**, 시각은 ISO. 클라이언트는 "오늘"을 계산하지 않고 서버 응답의 `today`를 쓴다. 날짜 조작용 env·API는 두지 않는다.
- 오류 응답은 항상 `{error:{code,message,details?}}`. 새 코드는 `backend/API.md`에 적는다.
- UI 문구는 한국어 존댓말("~해요"). 민감 정보(비밀번호·임시 비밀번호)는 로그·응답·문서에 남기지 않는다.

## 2. 지금 진행 중인 작업: 챌린지 기능
**먼저 [docs/challenges/README.md](docs/challenges/README.md)를 읽는다.** 그다음 맡은 phase 문서 하나만 열고 그 문서의 작업 목록과 완료 기준(DoD)대로 한다.

| 맡은 일 | 읽을 문서 | 브랜치 |
| --- | --- | --- |
| 백엔드 1 | `docs/challenges/phase-1-backend.md` | `feat/challenges-be-1` |
| 프런트 1 | `docs/challenges/phase-1-frontend.md` | `feat/challenges-fe-1` |
| 백엔드 2 | `docs/challenges/phase-2-backend.md` | `feat/challenges-be-2` |
| 프런트 2 | `docs/challenges/phase-2-frontend.md` | `feat/challenges-fe-2` |
| 통합 | `docs/challenges/phase-3-integration.md` | `feat/challenges-integration` |

- API 모양은 [docs/challenges/api-contract.md](docs/challenges/api-contract.md)와 [docs/challenges/fixtures/](docs/challenges/fixtures/)가 기준이다. 프런트는 픽스처로 mock을 만들어 서버 없이 개발하고, 백엔드는 픽스처와 응답 키가 같은지 테스트한다.
- 계약을 바꿔야 하면 **코드보다 먼저** `api-contract.md`와 픽스처를 고치고, PR 본문 첫 줄에 `계약 변경: …`을 쓴다. 상대 영역(백엔드 ↔ 프런트) 파일은 자기 phase에서 건드리지 않는다.
- 범위 밖 버그를 발견하면 고치지 말고 PR 본문 "발견한 문제"에 적는다.

## 3. 실행·검증 명령
```sh
npm install
npm run setup                 # 전용 PostgreSQL(55432) 시작 + prisma generate + migrate deploy. initdb/pg_ctl/psql/createdb 필요
npm run dev                   # 백엔드 4000, 프런트 5173 (127.0.0.1로 접속)
npm test                      # 도메인·스크립트·통합 테스트. 통합은 backend/.env의 TEST_DATABASE_URL 필요
npm run build                 # 디자인 템플릿 추출(python3) + vite build
npm run bootstrap-teacher --workspace backend   # 교사 계정 1회 생성(비밀번호는 프롬프트 입력)
VITE_CHALLENGE_API=mock npm run dev --workspace frontend   # 챌린지 화면을 mock으로 개발
```
- PostgreSQL CLI가 없으면 `npm run setup`이 실패한다. 설치가 어려우면 `backend/.env.example`을 참고해 접속 가능한 DB를 직접 연결한다. 영상 검사는 `ffprobe`(`FFPROBE_PATH`), 영상 테스트는 `ffmpeg`(`FFMPEG_PATH`, 없으면 그 검사만 건너뜀).
- 5173 포트가 다른 앱에 잡혀 있으면 `npm run dev --workspace frontend -- --port 5174`로 띄우고 `backend/.env`의 `APP_ORIGIN`에 그 주소를 추가한다.
- 통합 테스트는 `_test`로 끝나는 DB에 임시 스키마를 만들어 쓰고 지운다. 운영 DB에 테스트 데이터를 넣지 않는다.

## 4. 코드 규칙
- ESM, Node 22+, TypeScript 없음. 기존 파일의 밀도 높은 한 줄 스타일을 따르되 새 모듈은 읽기 쉬운 쪽을 택해도 된다. 세미콜론·작은따옴표 유지.
- 백엔드: 입력 검증은 라우터 진입부에서 `fail(status, CODE, message)`. 동시성은 `updateMany(...).count` 검사나 Serializable 트랜잭션. DB 불변식은 Prisma 스키마 + 마이그레이션 SQL의 CHECK로 둔다. 마이그레이션 폴더 이름은 `YYYYMMDDHHMMSS_설명`.
- 프런트: 디자인 템플릿 화면은 `DesignTemplate`/`TemplateSlots` + `useCallback` setup 패턴, 새 관리 화면은 `teacher.jsx`처럼 순수 React. 서버 호출은 `shared.jsx`의 `api()`. 상태를 템플릿 DOM에만 두지 말고 React 상태로 유지한다(템플릿은 재렌더 때 통째로 다시 그려진다).
- 테스트는 `node:test` + `node:assert/strict`. 도메인 규칙은 DB 없는 단위 테스트, API는 `backend/test/integration.test.js`에 하위 테스트로 추가.
- 커밋 메시지는 `feat:`/`fix:`/`docs:` 접두어 + 영어 한 줄 요약, 본문은 자유. PR 제목도 같은 형식.

## 5. 하지 말 것
- `main`에 직접 push. 항상 브랜치 + PR.
- `.env`, `.local/`, `backend/storage/`, `output/implementation-previews/` 커밋(학생 기록·비밀번호가 들어간다).
- `frontend/src/design-templates.json`, `design.css`, `design-icons.json`을 손으로 수정(`frontend/scripts/extract-design.py`가 생성한다. 아이콘 추가는 그 스크립트에서).
- 운영 DB에 시드·시연 데이터 적재, 날짜 되돌리기 기능 추가, 레거시 2026 집계 결과를 바꾸는 변경.
- 비밀번호·토큰을 CLI 인수나 문서에 적기.

## 6. PR에 꼭 쓸 것
1. 맡은 phase와 완료 기준 체크 결과.
2. `npm test`·`npm run build` 결과(실패·skip 포함).
3. 계약 변경 여부(`계약 변경:` 줄).
4. 화면 작업이면 체크리스트 수행 결과 요약(캡처는 저장소 밖 `output/implementation-previews/`).
5. 범위 밖에서 발견한 문제.
