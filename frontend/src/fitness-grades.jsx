import React from 'react';
import { fitnessComparison, fitnessGradeLabel, isFitnessGrade } from './fitness-grades.js';

export function FitnessGradeChip({ student }) {
  return <span className={`chip ${isFitnessGrade(student?.fitnessGrade) ? 'g' : ''}`} title={student?.fitnessGradeYear ? `${student.fitnessGradeYear}년 ${student.fitnessGradeSemester}학기 체력등급` : '체력등급 미등록'}>{fitnessGradeLabel(student?.fitnessGrade)}</span>;
}

export function FitnessHistory({ student, history }) {
  const { previous, current } = fitnessComparison(student, history);
  return <section className="card pad mt12" aria-label="체력등급 이력"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16 }}>
    {[[previous, '이전 체력등급'], [current, '현재 체력등급']].map(([assessment, label], index) => <div key={label} style={index ? { borderLeft: '1px solid var(--line)', paddingLeft: 16 } : undefined}>
      <div className="fs12 muted fw7">{label}</div><div className={`fs18 fw8 mt4 ${index && assessment ? 'gtext' : ''}`}>{fitnessGradeLabel(assessment?.grade)}</div>
      <div className="fs12 muted mt4">{assessment ? `${assessment.year}년 ${assessment.semester}학기` : '등록된 자료가 없어요.'}</div>
    </div>)}
  </div></section>;
}
