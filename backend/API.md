# Self Fit API contract

Base `/api`; backend local port `4000`. JSON request/response unless a file is described. Session authentication uses an HttpOnly cookie; fetch with `credentials: 'include'`. Mutation requests require the same origin (local frontend origin configured by `APP_ORIGIN`). Errors: `{error:{code,message,details?}}`. Success objects are described below, not wrapped in `data`. All activity dates are Korea `YYYY-MM-DD`; timestamps are ISO instants. No client date override exists.

`User = {id,role:'student'|'teacher',studentNumber,name,grade,classNumber,targetType:'required'|'optional'|null,participating,mustChangePassword,lastLoginAt:null|ISO}`.
`Record = {id,date,value,version,attachments:[{id,name,kind,size,url}],history,updatedAt}`. Teacher student-detail records include `history:[{id,beforeValue,afterValue,reason,createdAt,actorId,source}]`.
Values: walking integer band `0..5`; check boolean; counts nonnegative integer; distance finite nonnegative number. Dumbbell value is `{D12_CURL:number|null,D12_SQUAT:number|null,D12_ROW:number|null}` with exactly these three keys and nonnegative safe-integer set counts. At least one exercise must be non-null. Each exercise requires two completed sets of ten repetitions. A day is achieved only when all three targets are met; three achieved days in 2026-08-31–09-04 complete week 12. Missing values remain missing, never 0. Extra sets cannot compensate for another exercise or day.

## Authentication

- `POST /auth/login {studentNumber,password}` → `{user}`. Teacher uses its configured account identifier in studentNumber.
- `GET /auth/me` → `{user}`. 401 when unauthenticated.
- `POST /auth/logout {}` → `{ok:true}`.
- `POST /auth/change-password {currentPassword?,newPassword}` → `{user}`. 8–128 characters including English letters and digits, must differ from student number. `currentPassword` is optional only for authenticated first-login temporary-password sessions. First-login accounts can only use auth endpoints until changed.
- `GET /health` → database readiness only; no account details.

## Student

- `GET /program` → `{year:2026,today,status:'upcoming'|'active'|'rest'|'ended',startDate,endDate,weeks,activityDates,week12Pending:false}`. Each week has `week,title,startDate,endDate,inputType,weeklyTarget,dailyTarget,unit,color,description,deferred`. Week 12 also exposes `exercises:[{id,title,repetitions,targetSets,sideRule}]`; its summary totals count achieved days, with a weekly target of three.
- `GET /student/dashboard` → `{user,program,summary,records,unreadCount}`. Summary `{weeks,completedWeeks,totalWeeks,pendingWeeks,complete,progress,status}`. Week summary includes `week,weekdayTotal,weekendTotal,total,weekdayAchieved,weekendAchieved,makeupDays,complete,progress,status,recordedDays`.
- `POST /student/enroll {}` → `{user}`. Optional students only, before 2026-05-04.
- `GET /student/records` → `{records,summary}`.
- `GET /student/records/:date` → `{record:null|Record,corrections,week,dailyStatus,editable}`.
- `PUT /student/records/:date {value,version?}` → `{record,summary}`. Same Korea date only, participating students, active date. Existing record requires `version` (optimistic conflict check). Never sums with the previous value.
- `POST /student/records/:date/corrections {value,reason,version}` → `{correction}`. Existing past record only, one pending request; leaves effective value unchanged.
- `GET /student/corrections` → `{corrections}`. Correction includes `{id,recordId,date,beforeValue,requestedValue,reason,status,decisionReason,createdAt,decidedAt}`.
- `GET /student/notifications` → `{notifications,unreadCount}`. Notification `{id,type,title,body,readAt,createdAt}`.
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

Common filters: `search,grade,classNumber,targetType,participating,achievement` (`complete|incomplete|pending`), `week` (1..12), `studentIds` (comma-separated IDs). Nonparticipant students remain roster members but do not enter performance denominator.

- `GET /teacher/overview?filters` → `{students:[User & {summary,records}],program,stats:{students,participants,completed,denominator},filters}`. Full local-school dataset (82 dates), no synthetic rows.
- `GET /teacher/participation?grade=&classNumber=&targetType=` → `{summary,weeks,grades,classes,targets,filters,filterOptions}`. Only enrolled participants enter the cohort. Summary/group `completionRate` is `completedWeeks/(participants*12)*100`; weekly rate is completed students/participants*100. Rates are unrounded 0–100, null for empty cohorts. Summary includes `participants,completedWeeks,possibleWeeks,totalWeeks,pendingWeeks`; groups include identity/label and the same counts. `filterOptions` contains all registered student grades/classes independently of the active filters. No student identity or individual records are returned.
- `GET /teacher/students?filters` → `{students:[User]}`.
- `POST /teacher/students {studentNumber,name,grade,classNumber,targetType}` → `{user,temporaryPassword}`. Password returned once only.
- `PATCH /teacher/students/:id {studentNumber?,name?,grade?,classNumber?,targetType?}` → `{user}`. Promoting optional to required enrolls; no deletion of records.
- `DELETE /teacher/students/:id` → `{ok:true}`. Only accounts without records/corrections can be deleted; otherwise 409 preserving evidence.
- `GET /teacher/students/:id` → `{user,records,summary,corrections}`.
- `POST /teacher/students/:id/reset-password {}` → `{temporaryPassword}`; revokes all existing student sessions.
- `GET /teacher/roster/template` → XLSX with headers `학번,이름,학년,반,대상구분` and no fake students.
- `POST /teacher/roster/validate` multipart `file` (.xlsx, max 5MB) → `{importId,rows:[{studentNumber,name,grade,classNumber,targetType}],errors:[{row,message}],expiresAt}`. Strict validation, no writes. target labels `필수|선택` (or required|optional). Duplicates/existing student numbers are errors. Import expires after 30 min.
- `POST /teacher/roster/commit {importId}` → `{created,credentials:[{studentNumber,name,temporaryPassword}]}`. Atomic, consumes validated import exactly once. Save passwords locally at this response; they cannot be retrieved again.
- `GET /teacher/corrections?status=pending|approved|rejected|all` → `{corrections}` including student identity and current Record. A pending request with a matching current record version includes `preview:{before:WeekSummary,after:WeekSummary}`; stale/decided requests have `preview:null`. Preview never writes data.
- `GET /teacher/corrections/export?status=all|pending|approved|rejected` → XLSX correction audit history, including original/requested values, reasons, requester, teacher, status and Korea timestamps. This is separate from current effective activity export.
- `POST /teacher/corrections/:id/approve {}` → `{correction,record}`. Atomic version check; stale request gets 409 and never overwrites current record.
- `POST /teacher/corrections/:id/reject {reason}` → `{correction}`. Nonempty reason required.
- `GET /teacher/export?filters` → XLSX sheets summary, weekly, daily, dumbbell details, metadata. Dumbbell detail preserves each exercise's set count, missing vs zero, target, converted repetitions and side rule. Current effective values; no original media embedded. Week filter narrows weekly/daily/dumbbell sheets, summary retains whole-program meaning.

## Runtime

`DATABASE_URL`, `APP_ORIGIN` (default http://localhost:5173), `PORT` (4000), `HOST` (127.0.0.1), `STORAGE_DIR` private absolute path, `FFPROBE_PATH` optional, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` optional. Push configuration absence never blocks app notifications. Reminder scheduler runs each minute, Korea 20:00 onwards on eligible activity dates, event uniqueness `(user,date,type)` prevents duplicates. It never sends exercise reminders after 2026-09-04. No automatic data/media deletion policy.

Immediately before each reminder push (including retries), the server rechecks the current Korea date, same-day event identity, participation, weekly completion, daily input and weekend setting. Obsolete reminder pushes become `cancelled`; their in-app event history remains. Correction-result pushes bypass exercise eligibility and may be sent after the program ends.

Initialize schema `npm run db:deploy`, then run `npm run bootstrap-teacher` in a terminal to enter the one real teacher's ID, name and hidden password. `TEACHER_ID`, `TEACHER_NAME`, and `TEACHER_PASSWORD` env or stdin JSON are also supported. Backend reads `backend/.env`. Never pass passwords on CLI args. No seed users or activity are installed.
