import React from 'react';
import ChallengeList from './ChallengeList.jsx';
import ChallengeEditor from './ChallengeEditor.jsx';
import '../challenges.css';

/** Teacher routes under /{mode}/admin/challenges. `path` is the part after /admin. */
export const challengeRoute = path => {
  const match = path.match(/^\/challenges(?:\/([^/]+))?\/?$/);
  return match ? { id: match[1] ? decodeURIComponent(match[1]) : null } : null;
};

export default function ChallengesApp({ mode, path }) {
  const route = challengeRoute(path);
  if (!route?.id) return <ChallengeList mode={mode} />;
  if (route.id === 'new') return <ChallengeEditor key="new" mode={mode} />;
  return <ChallengeEditor key={route.id} mode={mode} id={route.id} />;
}
