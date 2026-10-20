# Self Fit API contract

Base `/api`; backend local port `4000`. JSON request/response unless a file is described. Session authentication uses an HttpOnly cookie; fetch with `credentials: 'include'`. Mutation requests require the same origin (local frontend origin configured by `APP_ORIGIN`). Errors: `{error:{code,message,details?}}`. Success objects are described below, not wrapped in `data`. All activity dates are Korea `YYYY-MM-DD`; timestamps are ISO instants. No client date override exists.

`User = {id,role:'student'|'teacher',studentNumber,name,grade,classNumber,targetType:'required'|'optional'|null,participating,mustChangePassword,lastLoginAt:null|ISO,createdAt:ISO}`.
`Record = {id,date,value,version,attachments:[{id,name,kind,size,url}],history,updatedAt}`. Teacher student-detail records include `history:[{id,beforeValue,afterValue,reason,createdAt,actorId,source}]`.
Values: walking integer band `0..5`; check boolean; counts nonnegative safe integer; distance finite nonnegative number. Dumbbell values have exactly the keys in the selected week's `exercises[].id`, each holding a nonnegative safe-integer set count or null. At least one exercise must be non-null. A day is achieved only when every exercise reaches its own `targetSets`; `weeklyTarget` achieved days complete that week. The legacy 2026 challenge retains `{D12_CURL:number|null,D12_SQUAT:number|null,D12_ROW:number|null}`, ten repetitions × two sets per exercise and three achieved days during 2026-08-31–09-04. Missing values remain missing, never 0. Extra sets cannot compensate for another exercise or day.

## Authentication

- `POST /auth/login {studentNumber,password}` → `{user}`. Teacher uses its configured account identifier in studentNumber. Failed attempts are limited to 10 per account and 300 per client address in 15 minutes (429 `RATE_LIMITED`); successful logins do not count. Set `TRUST_PROXY` behind a reverse proxy.
- `GET /auth/me` → `{user}`. 401 when unauthenticated.
- `POST /auth/logout {}` → `{ok:true}`.
- `POST /auth/change-password {currentPassword?,newPassword}` → `{user}`. 8–128 characters including English letters and digits, must differ from student number. `currentPassword` is optional only for authenticated first-login temporary-password sessions. First-login accounts can only use auth endpoints until changed.
- `GET /health` → database readiness only; no account details.

## Challenges (phase 1 backend)

The authoritative challenge types, validation rules, requests, response fixtures and error codes are in [the challenge API contract](../docs/challenges/api-contract.md) and [shared JSON fixtures](../docs/challenges/fixtures/). Phase 1 implements the teacher challenge collection/detail, create, patch, duplicate, publish, archive and draft-delete endpoints. Membership selection/invitation and explicit student challenge endpoints belong to phase 2; the linked contract describes their planned interface, not a phase 1 completion claim.

A challenge contains its own ordered weeks, activity dates and memberships. Lifecycle is `draft → published → archived`; `phase` is computed from the server's Korean date as `draft|upcoming|active|rest|ended|archived`. Only a draft may be deleted. Week structure and dates are editable while draft or before the published start date; once started, only title, description and color may change. Duplicating creates a draft with shifted dates and retained rest gaps, without copying participants or records.

Legacy paths resolve the current challenge on each request:

- Teacher: the published challenge with the latest `startDate`; an explicit `challengeId` query selects another existing challenge, including draft/archived for teacher review.
- Student: an active membership in a published challenge, preferring phase `active`, then `upcoming`, then `rest`, otherwise the most recently ended challenge. No match yields no current challenge. `GET /program` returns `404 CHALLENGE_NOT_FOUND`; legacy student reads retain their empty nonparticipant response (dashboard `program:null`, empty records and a zero-week summary; single-date record `null`).

`GET /teacher/overview`, `/teacher/participation`, `/teacher/export`, `/teacher/corrections`, `/teacher/students/:id` accept `challengeId`; the correction audit export also accepts it. JSON responses from these scoped reads include `challenge: ChallengeSummary`. Exports remain XLSX files and use only the selected challenge's weeks and records. Performance denominators and scoped `User.participating` are determined by `ChallengeMembership.status='active'`. The roster endpoint `/teacher/students` remains account-wide; `targetType` is the roster's required/optional classification. Creating a required student or changing that classification does not enroll them in a challenge; phase 2's forced-registration action does that. The existing account-wide `User.participating` flag is retained for phase 1 compatibility and is not the authority for challenge membership.

Challenge errors use the standard `{error:{code,message,details?}}` envelope: `400 INVALID_CHALLENGE` includes `details:[{path,message}]`; `404 CHALLENGE_NOT_FOUND`; `409 CHALLENGE_LOCKED`, `CHALLENGE_ARCHIVED`, `CHALLENGE_NOT_DRAFT`, `ALREADY_PUBLISHED` and `CHALLENGE_NOT_PUBLISHED`. Explicit challenge record access and record mutations without an active membership return `403 NOT_MEMBER`; the legacy empty-read compatibility above is retained. See the contract for phase 2 invitation errors.

## Student

- `GET /program` → `{challengeId,year,today,status,startDate,endDate,weeks,activityDates,week12Pending}` using `programDto(challenge)`; no current challenge returns `404 CHALLENGE_NOT_FOUND`. The previous response fields remain, and year/dates/week count come from the selected challenge. Week definitions contain `week,title,startDate,endDate,inputType,weeklyTarget,dailyTarget,unit,dailyUnit,color,description`; dumbbell weeks expose `exercises:[{id,title,repetitions,targetSets,sideRule}]`. `week12Pending` remains false for the settled legacy challenge.
- `GET /student/dashboard` → `{user,program,summary,records,unreadCount}`. Summary `{weeks,completedWeeks,totalWeeks,pendingWeeks,complete,progress,status}`. Week summary includes `week,weekdayTotal,weekendTotal,total,weekdayAchieved,weekendAchieved,makeupDays,complete,progress,status,recordedDays`.
- `POST /student/enroll {}` remains a legacy compatibility path; phase 1 returns `403 ENROLLMENT_CLOSED` when no pending invitation can be accepted. Phase 2 connects this path to current-challenge invitation acceptance under the challenge contract.
- `GET /student/records` → `{records,summary}`.
- `GET /student/records/:date` → `{record:null|Record,corrections,week,dailyStatus,editable}`.
- `PUT /student/records/:date {value,version?}` → `{record,summary}`. Same Korea date only, participating students, active date. Existing record requires `version` (optimistic conflict check). Never sums with the previous value.
- `POST /student/records/:date/corrections {value,reason,version}` → `{correction}`. Existing past record only, one pending request; leaves effective value unchanged.
- `GET /student/corrections` → `{corrections}`. Correction includes `{id,challengeId,recordId,date,beforeValue,requestedValue,reason,status,decisionReason,createdAt,decidedAt}`; this list remains account-wide.
- `GET /student/notifications` → `{notifications,unreadCount}`. Notification `{id,type,title,body,data,readAt,createdAt}`; `data` is null for existing reminder/correction events and reserves `{challengeId,membershipId}` for invitation/enrollment events.
- `POST /student/notifications/:id/read {}` → `{ok:true}`.
- `POST /student/notifications/read-all {}` → `{ok:true}`.
- `GET /student/settings` → `{weekendReminder,pushEnabled,pushPublicKey}`.
- `PATCH /student/settings {weekendReminder}` → same settings.
- `POST /student/push-subscriptions {endpoint,keys:{p256dh,auth}}` → `{ok:true}`.
- `DELETE /student/push-subscriptions {endpoint}` → `{ok:true}`.
- `POST /student/records/:date/attachments` multipart field `file` → `{attachment}`. Record must already exist. Images max 3×10MB, video max 1×100MB/60 seconds; same-day start. Numeric record is preserved on upload failure.
- `DELETE /student/records/:date/attachments/:id` → `{ok:true}`. Same-day only.
- `GET /attachments/:id` → private file; owner student or teacher only. File `url` points here.

## Teacher

Common filters: `search,grade,classNumber,targetType,participating,achievement` (`complete|incomplete|pending`), `week` (1..20, must exist in the selected challenge), `studentIds` (comma-separated IDs). Students without an active membership remain roster members but do not enter that challenge's performance denominator.

- `GET /teacher/overview?filters` → `{students:[User & {summary,records}],challenge,program,stats:{students,participants,completed,denominator},filters}`. School roster with records and summaries scoped to the chosen challenge (82 dates for the legacy challenge), no synthetic rows.
- `GET /teacher/participation?grade=&classNumber=&targetType=` → `{challenge,summary,weeks,grades,classes,targets,filters,filterOptions}`. Only active memberships in the selected challenge enter the cohort. Summary/group `completionRate` is `completedWeeks/(participants*totalWeeks)*100`; weekly rate is completed students/participants*100. Rates are unrounded 0–100, null for empty cohorts. Summary includes `participants,completedWeeks,possibleWeeks,totalWeeks,pendingWeeks`; groups include identity/label and the same counts. `filterOptions` contains all registered student grades/classes independently of the active filters. No student identity or individual records are returned.
- `GET /teacher/students?filters` → `{students:[User]}`.
- `POST /teacher/students {studentNumber,name,grade,classNumber,targetType}` → `{user,temporaryPassword}`. Password returned once only. Existing student number → 409 `DUPLICATE_NUMBER`.
- `PATCH /teacher/students/:id {studentNumber?,name?,grade?,classNumber?,targetType?}` → `{user}`. Updates the account-wide roster classification; challenge participation is determined by its active membership. No deletion of records.
- `DELETE /teacher/students/:id` → `{ok:true}`. Only accounts without records/corrections can be deleted; otherwise 409 preserving evidence.
- `GET /teacher/students/:id` → `{challenge,user,records,summary,corrections}`.
- `POST /teacher/students/:id/reset-password {}` → `{temporaryPassword}`; revokes all existing student sessions.
- `GET /teacher/roster/template` → XLSX with headers `학번,이름,학년,반,대상구분` and no fake students.
- `POST /teacher/roster/validate` multipart `file` (.xlsx, max 5MB) → `{importId,rows:[{studentNumber,name,grade,classNumber,targetType}],errors:[{row,message}],expiresAt}`. Strict validation, no writes. target labels `필수|선택` (or required|optional). Duplicates/existing student numbers are errors. Import expires after 30 min.
- `POST /teacher/roster/commit {importId}` → `{created,credentials:[{studentNumber,name,temporaryPassword}]}`. Atomic, consumes validated import exactly once. Save passwords locally at this response; they cannot be retrieved again.
- `GET /teacher/corrections?status=pending|approved|rejected|all` → `{challenge,corrections}` including student identity and current Record. A pending request with a matching current record version includes `preview:{before:WeekSummary,after:WeekSummary}`; stale/decided requests have `preview:null`. Preview never writes data.
- `GET /teacher/corrections/export?status=all|pending|approved|rejected` → XLSX correction audit history, including original/requested values, reasons, requester, teacher, status and Korea timestamps. This is separate from current effective activity export.
- `POST /teacher/corrections/:id/approve {}` → `{correction,record}`. Atomic version check; stale request gets 409 and never overwrites current record.
- `POST /teacher/corrections/:id/reject {reason}` → `{correction}`. Nonempty reason required.
- `GET /teacher/export?filters` → XLSX sheets summary, weekly, daily, dumbbell details, metadata. Dumbbell detail preserves each exercise's set count, missing vs zero, target, converted repetitions and side rule. Current effective values; no original media embedded. Week filter narrows weekly/daily/dumbbell sheets, summary retains the whole selected challenge's meaning.

## Runtime

`DATABASE_URL`, `APP_ORIGIN` (default http://localhost:5173), `PORT` (4000), `HOST` (127.0.0.1), `STORAGE_DIR` private absolute path, `FFPROBE_PATH` optional, `TRUST_PROXY` optional (Express trust-proxy value behind a reverse proxy), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` optional. Push configuration absence never blocks app notifications. Reminder scheduler runs each minute, Korea 20:00 onwards, separately for published challenges whose phase is active. Active membership and that challenge's weeks determine eligibility; event key `reminder:<challengeId>:<userId>:<date>` prevents duplicates within each challenge. It never sends exercise reminders beyond that challenge's endDate. Existing pre-migration reminder keys remain history and are not sent again. No automatic data/media deletion policy.

Immediately before each reminder push (including retries), the server rechecks the current Korea date, same-day challenge/event identity, published lifecycle, active membership, weekly completion, daily input and weekend setting. Obsolete reminder pushes become `cancelled`; their in-app event history remains. Correction-result pushes bypass exercise eligibility and may be sent after the program ends.

Initialize schema `npm run db:deploy`, then run `npm run bootstrap-teacher` in a terminal to enter the one real teacher's ID, name and hidden password. `TEACHER_ID`, `TEACHER_NAME`, and `TEACHER_PASSWORD` env or stdin JSON are also supported. Backend reads `backend/.env`. Never pass passwords on CLI args. No seed users or activity are installed.
