// Mock-only: the legacy 2026 program's weeks, so the list fixture's "c2026-legacy" summary
// can be opened and used as a template. Mirrors backend/src/domain/index.js WEEKS as the
// contract stores them (walking dailyTarget is null). Not used by the real API client.
const week = (n, title, startDate, endDate, inputType, weeklyTarget, dailyTarget, unit, dailyUnit, color, description, extra = {}) => ({
  id: `legacy-w${n}`, week: n, title, startDate, endDate, inputType, weeklyTarget, dailyTarget, unit, dailyUnit, color, description, ...extra,
});

export const legacyWeeks = [
  week(1, '만보 걷기', '2026-05-04', '2026-05-10', 'walking', 5, null, '일', '보', '#E07A2E', '하루 10,000보 이상, 기준을 충족한 5일'),
  week(2, '아침 스트레칭', '2026-05-18', '2026-05-24', 'check', 5, 5, '일', '분', '#2E9E6A', '등교 후 5분 스트레칭, 수행 5일'),
  week(3, '줄넘기', '2026-05-25', '2026-05-31', 'count', 1000, 200, '회', '회', '#2F7FD8', '하루 200회, 주간 합계 1,000회 이상'),
  week(4, '플랭크', '2026-06-01', '2026-06-07', 'check', 5, 1, '일', '분', '#8A5CD6', '1분 이상 유지, 기준을 충족한 5일'),
  week(5, '스쿼트', '2026-06-08', '2026-06-14', 'count', 500, null, '회', null, '#D9486A', '주간 합계 500회 이상'),
  week(6, '계단 오르기', '2026-06-15', '2026-06-21', 'check', 5, 20, '일', '층', '#1E9FA8', '하루 20층 이상, 기준을 충족한 5일'),
  week(7, '팔굽혀펴기', '2026-06-22', '2026-06-28', 'count', 1000, null, '회', null, '#C08A12', '주간 합계 1,000회 이상'),
  week(8, '러닝·워킹', '2026-06-29', '2026-07-05', 'distance', 10, null, 'km', null, '#4C6FD1', '주간 합계 10km 이상'),
  week(9, '윗몸 일으키기', '2026-07-06', '2026-07-12', 'count', 1000, null, '회', null, '#C2552B', '주간 합계 1,000회 이상'),
  week(10, '버피 테스트', '2026-08-17', '2026-08-23', 'count', 300, 60, '회', '회', '#3C9A3C', '하루 60회, 주간 합계 300회 이상'),
  week(11, '홈트 15분', '2026-08-24', '2026-08-30', 'check', 5, 15, '일', '분', '#A2508F', '하루 15분 서킷, 수행 5일'),
  week(12, '덤벨 운동', '2026-08-31', '2026-09-04', 'dumbbell', 3, 3, '일', '종목', '#5A6372', '하루 컬·스쿼트·로우 각 10회씩 2세트, 세 종목을 모두 충족한 3일 이상', {
    exercises: [
      { id: 'D12_CURL', title: '덤벨 컬', repetitions: 10, targetSets: 2, sideRule: '좌우 각각 10회 = 1세트' },
      { id: 'D12_SQUAT', title: '덤벨 스쿼트', repetitions: 10, targetSets: 2, sideRule: '전체 10회 = 1세트' },
      { id: 'D12_ROW', title: '덤벨 로우', repetitions: 10, targetSets: 2, sideRule: '좌우 각각 10회 = 1세트' },
    ],
  }),
];
