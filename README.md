# Self-Fit

2026년 학생 운동 기록과 교사 참여 현황을 관리하는 로컬 프로젝트입니다. `frontend/`는 React, `backend/`는 Express·Prisma·PostgreSQL로 구성했습니다.

## 실행

Node.js 22.12 이상, Python 3(`python3`), PostgreSQL 명령 도구(`initdb`, `pg_ctl`, `psql`, `createdb`), 영상 길이 검사용 `ffprobe`가 필요합니다. Python은 빌드 시 원본 디자인을 추출하는 데 사용하며 추가 패키지는 필요하지 않습니다.

```sh
npm install
npm run setup
npm run dev
```

`npm run setup`은 프로젝트 전용 DB와 `backend/.env`를 자동으로 생성합니다. 수동으로 DB 연결을 설정할 때는 `backend/.env.example`을 참고하세요. 저장소에는 로컬 DB·계정 비밀번호·첨부·학생 기록이 보이는 검수 캡처를 포함하지 않으므로, 새로 복제한 환경에서는 빈 DB로 시작합니다.

- 웹: http://127.0.0.1:5173/web
- 모바일 고정 화면: http://127.0.0.1:5173/mobile
- 원본 시안 비교: http://127.0.0.1:5173/design
- API: http://127.0.0.1:4000/api

현재 컴퓨터에서는 `localhost:5173`에 다른 앱이 응답할 수 있으므로 위의 **127.0.0.1 주소**를 사용하세요. 두 서버가 모두 실행되었다는 메시지가 나온 뒤 접속합니다. 터미널의 Ctrl+C로 앱 서버를 종료하고, DB도 종료하려면 `npm run db:stop`을 실행합니다.

## 첫 교사 계정

새 DB를 준비할 때는 아래 명령으로 교사 계정을 생성한 뒤 로그인하고, 명단 관리에서 학생을 등록하거나 빈 엑셀 양식을 내려받아 가져올 수 있습니다. 이미 계정이 있는 DB에서는 기존 로그인 정보를 사용합니다.

```sh
npm run bootstrap-teacher --workspace backend
```

교사 ID·이름·비밀번호를 터미널에서 입력합니다. 비밀번호는 화면에 표시하지 않습니다. 학생 임시 비밀번호는 발급 시 한 번만 표시되고 첫 로그인에서 변경하도록 처리합니다.

## 제공된 참여 자료 가져오기

사용자가 제공한 가상 참여 자료는 기존 12주 운영 일정에 맞춰 별도 초기 적재합니다. 같은 운동의 7일 기록을 한 묶음으로 선택하고 요일을 유지하여 옮깁니다. 학생별 평일 참여율, 완료 주수 비율, 주말 참여율과 가까운 조합을 선택하며 값을 합산하거나 평균내지 않습니다. 첫 참여 자료는 1–11주차만 재분배하며, 12주차는 별도로 제공된 덤벨 파일을 사용합니다. 빈칸과 명시적 0·미수행을 구분합니다.

원본 엑셀 전체와 원본 행은 `.local/imports/` 및 DB의 `SourceDataset`에 보관합니다. 실제 체력 자료로 표시된 점수·등급은 `StudentSource`에 원값으로 보관하며 가상 운동 기록과 구분합니다. 각 운동 기록에는 선택한 원본 행과 날짜를 연결합니다. 자료에 없는 과거 수정·정정·알림·첨부·등록 시각은 만들지 않습니다. DB 생성 시각은 적재 시각입니다.

`scripts/extract-participation.py`는 엑셀을 JSON으로 추출하며, `backend/scripts/import-participation.js`는 기본적으로 미리보기만 수행합니다. `--apply`를 붙여 실행할 때 원본·계정·기록을 하나의 트랜잭션으로 적재합니다. 동일 원본은 재적재하지 않고, 기존 계정과 충돌하면 비밀번호나 기록을 덮어쓰지 않습니다. 계정별 초기 비밀번호 파일은 해당 `.local/imports/` 폴더에만 저장되며 저장소에 포함하지 않습니다.

별도 덤벨 자료는 `backend/scripts/import-dumbbell-data.js`로 기존 194명에게 연결합니다. `backend/`에서 `node --env-file=.env scripts/import-dumbbell-data.js ../.local/imports/2026-10-20-dumbbell/source.json --dry-run`으로 확인하며, `--apply`일 때만 추가합니다. 5일×3종목의 원본을 모두 보관하고 하나라도 입력한 날짜만 기록으로 생성합니다. 같은 원본을 다시 실행하면 저장값을 대조하고 종료하며, 기존 날짜와 충돌하면 덮어쓰지 않고 중단합니다.

12주 전체를 다시 작성한 수정 자료는 `backend/scripts/import-revised-participation.js`로 갱신합니다. `scripts/extract-participation.py`로 원본 엑셀을 프로젝트 내부 `.local/imports/<작업 폴더>/`에 추출하고, 같은 폴더에 DB 백업과 백업 검증 정보를 준비한 뒤 실행합니다. 원본 행과 수식·계산 캐시를 보관하고 실제 앱 규칙으로 학생별·대상별·주차별 완료 수를 대조합니다. 기본 실행은 읽기 전용 미리보기이며 `--apply`를 명시할 때만 반영합니다.

수정 적재는 기존 계정·비밀번호·세션과 이전 원본을 보존합니다. 같은 학생·날짜의 기록은 기존 ID를 유지하고, 추가 입력일을 생성하며 수정본에서 빈 날짜가 된 기존 가상 기록은 제거합니다. 변경 전 기록과 출처는 새 원본의 변경 이력에 보관합니다. 사용자 수정·정정 요청·첨부와 충돌하면 반영을 중단합니다. 같은 파일 재실행은 저장 결과를 확인하고 종료합니다. 원본 파일·DB 백업·실제 체력 자료는 GitHub에 업로드하지 않습니다.

```sh
node --env-file=backend/.env backend/scripts/import-revised-participation.js ".local/imports/<작업 폴더>/source.json" --dry-run
node --env-file=backend/.env backend/scripts/import-revised-participation.js ".local/imports/<작업 폴더>/source.json" --apply
```

적용 전 같은 폴더의 `before-revision.dump`와 `backup-manifest.json`이 필요합니다. 백업 정보에는 `backupFile`, `backupSha256`, `database`, `users`, `records`, `sourceDatasetHashes`, `protectedRelations`를 기록합니다. 마지막 필드는 `corrections`, `revisions`, `attachments` 건수이며 모두 0이어야 합니다. CLI는 백업 파일 해시를 확인하고, 트랜잭션 안에서 현재 DB와 백업 시점의 계정·기록 수 및 원본 목록을 다시 비교합니다. 이 갱신 도구는 기존 최초 참여 자료와 덤벨 적재를 수정하기 위한 도구이며, 이미 다른 수정본을 반영한 DB는 임의로 다시 덮어쓰지 않습니다.

## 구성과 데이터

- `frontend/src/design.css`: 기존 시안 CSS. `design-templates.json`은 `docs/디자인`의 내부 서비스 화면에서 추출합니다.
- `frontend/public/brand/self-fit-original.png`: 첨부 로고 원본. CSS로 심볼과 글자를 각각 보여주고 가로로 배치합니다.
- `backend/src/domain/`: 주차·날짜·운동별 판정 규칙.
- `backend/prisma/`: 스키마와 DB 마이그레이션.
- `backend/API.md`, `backend/README.md`: API 계약과 서버 운영 안내.
- `.local/postgres/`: 이 프로젝트 전용 DB. 포트 55432, DB `self_fit`와 테스트 전용 `self_fit_test`를 사용합니다.
- `backend/storage/`: 로그인 권한 검사를 거쳐 제공하는 비공개 첨부 파일. 정적 웹 폴더에 공개하지 않습니다.
- `backend/.env`, `.local/db-password`: 자동 생성되는 로컬 비밀 설정. 저장소에 포함하지 않습니다.

모바일 370px, 웹 1438px 기준이며 시안 설명·휴대폰 프레임·가짜 상태바·브라우저 프레임은 제외했습니다. 중간 크기 전환 기준은 보류 상태입니다. 교사 웹 잔디는 16×16px 정사각형입니다.

## 동작 범위

학생 로그인·최초 비밀번호 변경·선택 대상 참여 신청, 날짜별 운동 기록·당일 수정, 사진·영상 첨부, 과거 기록 정정 요청, 내 기록·주차별 집계·알림·설정을 구현했습니다. 교사는 참여 현황·검색·필터·학생 상세, 명단 개별 등록·수정·엑셀 가져오기, 비밀번호 초기화, 정정 승인·반려·이력, 엑셀 내보내기와 운영 일정을 사용할 수 있습니다.

날짜는 실제 한국 시간으로 판단합니다. 운영 기간은 **2026-05-04부터 2026-09-04까지**이며, 수학여행·방학을 제외한 82일입니다. 현재는 종료 상태이므로 학생의 새 기록 입력은 막히고 기존 기록 조회·정정 요청이 가능합니다. 학생 모바일 홈은 종료 후에도 경로형 디자인으로 12주 실적을 표시합니다. 개발 편의를 위한 날짜 조작이나 참여 데이터 자동 입력은 포함하지 않았습니다.

12주차 덤벨은 2026-08-31~09-04 동안 컬·스쿼트·로우 각각 10회×2세트를 모두 채운 날이 3일 이상이면 완료합니다. 컬·로우는 좌우 각각 10회가 한 세트이며 환산 횟수에서 좌우를 다시 곱하지 않습니다. 종목별 초과 세트를 다른 종목이나 날짜의 부족분에 합산하지 않습니다. 12주 모두 완료하면 전체 완료입니다.

교사 **참여율** 화면(`/web/admin/participation`)은 학년·반·필수/선택 필터와 주차·학년·반·대상별 그래프를 제공합니다. 전체 완수율은 `완료한 학생별 주차 수 합계 ÷ (참여 학생 수 × 12)`이며, 주차별 완수율은 해당 주차 완료 학생 ÷ 참여 학생입니다. 비참여 학생은 제외하며 빈 집단은 0% 대신 집계 없음으로 표시합니다.

시연 환경은 보류했습니다. 브라우저 푸시 발송에는 별도 VAPID 설정과 브라우저 알림 권한이 필요하며, 외부 푸시 전달은 로컬 검증 범위에 포함하지 않았습니다.

## 검증

```sh
npm test
npm run build
```

API 통합 테스트는 이름이 `_test`로 끝나는 전용 DB에 임시 스키마를 만들고 종료 시 지웁니다. 운영 DB에는 테스트 계정과 기록을 넣지 않습니다. 브라우저 검증도 아래 명령으로 별도 포트·임시 스키마를 사용하며 Ctrl+C로 정리합니다.

```sh
node --env-file=backend/.env tests/browser-fixture.mjs
```

이 환경의 검증용 계정은 스크립트 안에만 정의되어 있으며 실제 서비스 계정이 아닙니다. 화면 캡처와 확인 결과는 `output/implementation-previews/`에 저장합니다.
