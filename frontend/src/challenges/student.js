// Student-side helpers shared by MyChallenges and the design-template screens, which
// can only take plain DOM (they are rebuilt from HTML on every setup).
import icons from '../design-icons.json';

const KEY = 'self-fit.challengeId';
/** Challenges the student can switch between: confirmed (active) memberships. */
export const switchable = mine => (mine?.challenges || []).filter(item => item.membership.status === 'active');

/** The challenge the student chose to look at; phase 3 puts it in the route. Falls back to the server's `current`. */
export function selectedChallengeId(mine) {
  const ids = [...switchable(mine), ...(mine?.archived || [])].map(item => item.challenge.id);
  let saved = null;
  try { saved = window.localStorage.getItem(KEY); } catch { /* storage may be blocked */ }
  return ids.includes(saved) ? saved : mine?.current?.challenge.id ?? ids[0] ?? null;
}
export function selectChallenge(id) {
  try { if (id) window.localStorage.setItem(KEY, id); else window.localStorage.removeItem(KEY); } catch { /* storage may be blocked */ }
}

/** "보관된 챌린지를 보고 있어요" on home/records while an archived challenge is selected. */
export function insertArchivedBanner(root, { mode, title, onLeave }) {
  const banner = document.createElement('div');
  banner.className = 'banner warn ch-invite-banner';
  const text = document.createElement('div');
  text.className = 'grow';
  text.innerHTML = '<b></b>';
  text.firstChild.textContent = `보관된 챌린지 · ${title}`;
  const hint = document.createElement('span');
  hint.className = 'ch-invite-hint';
  hint.textContent = ' 기록을 볼 수만 있어요.';
  text.append(hint);
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'act';
  action.textContent = '현재 챌린지로';
  action.onclick = onLeave;
  banner.append(icon('history'), text, action);
  if (mode === 'web') root.querySelector('main.w-main')?.prepend(banner);
  else {
    const anchor = root.querySelector('.scroll .page .page-sub') || root.querySelector('.scroll .page .page-title');
    banner.classList.add('mt16');
    anchor?.after(banner);
  }
}

const isClosed = item => item.challenge.today > item.challenge.enrollmentDeadline;
export const openInvitations = mine => (mine?.invitations || []).filter(item => !isClosed(item));

function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ class: 'i', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', width: size, height: size })) svg.setAttribute(key, value);
  svg.innerHTML = icons[name] || icons.chevron;
  return svg;
}
function activate(element, fn) {
  element.tabIndex = 0; element.setAttribute('role', 'button'); element.style.cursor = 'pointer';
  element.onclick = fn;
  element.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fn(); } };
}

/** "새 챌린지 초대가 n건 있어요" on the home template, linking to MyChallenges. */
export function insertInvitationBanner(root, { mode, count, onOpen }) {
  if (!count) return;
  const banner = document.createElement('div');
  banner.className = 'banner blue ch-invite-banner';
  const text = document.createElement('div');
  text.className = 'grow';
  text.innerHTML = '<b></b>';
  text.firstChild.textContent = `새 챌린지 초대가 ${count}건 있어요`;
  const hint = document.createElement('span');
  hint.className = 'ch-invite-hint';
  hint.textContent = ' 수락하면 참여가 확정돼요.';
  text.append(hint);
  const action = document.createElement('span');
  action.className = 'act';
  action.textContent = '확인하기';
  banner.append(icon('flag'), text, action);
  activate(banner, onOpen);
  if (mode === 'web') root.querySelector('main.w-main')?.prepend(banner);
  else {
    const sub = root.querySelector('.scroll .page .page-sub') || root.querySelector('.scroll .page .page-title');
    banner.classList.add('mt16');
    sub?.after(banner);
  }
}

/** 마이: current challenge + switcher (when there are two or more) + link to MyChallenges. */
export function insertChallengeEntry(root, { mode, mine, onOpen, onSwitch }) {
  if (!mine) return;
  const options = switchable(mine), selected = selectedChallengeId(mine);
  const current = [...options, ...(mine.archived || [])].find(item => item.challenge.id === selected) || mine.current;
  const invitations = openInvitations(mine).length;
  const label = current ? current.challenge.title : '참여 중인 챌린지가 없어요';
  if (mode === 'mobile') {
    const list = document.createElement('div');
    list.className = 'list mt16';
    const row = document.createElement('div');
    row.className = 'li link';
    const wrap = document.createElement('div'); wrap.className = 'ico-wrap'; wrap.append(icon('flag', 20));
    const key = document.createElement('div'); key.className = 'k'; key.textContent = '내 챌린지';
    const value = document.createElement('span'); value.className = 'v ch-entry-value'; value.textContent = invitations ? `초대 ${invitations}건` : label;
    row.append(wrap, key, value, icon('chevron'));
    activate(row, onOpen);
    list.append(row);
    root.querySelector('.scroll .page .list')?.before(list);
    return;
  }
  const card = document.createElement('div');
  card.className = 'card pad-lg mt16 ch-entry';
  const body = document.createElement('div'); body.className = 'grow';
  const title = document.createElement('div'); title.className = 'q'; title.textContent = '내 챌린지';
  const sub = document.createElement('div'); sub.className = 'fs14 t2 mt4';
  sub.textContent = invitations ? `${label} · 새 초대 ${invitations}건` : label;
  body.append(title, sub);
  card.append(body);
  if (options.length > 1) {
    const select = document.createElement('select');
    select.className = 'ch-entry-select';
    select.setAttribute('aria-label', '보고 있는 챌린지');
    for (const item of options) { const option = document.createElement('option'); option.value = item.challenge.id; option.textContent = item.challenge.title; select.append(option); }
    select.value = selected;
    select.onchange = () => {
      selectChallenge(select.value);
      sub.textContent = options.find(item => item.challenge.id === select.value)?.challenge.title || label;
      onSwitch?.(select.value);
    };
    card.append(select);
  }
  const button = document.createElement('button');
  button.className = 'btn secondary';
  button.textContent = '챌린지 보기';
  button.onclick = onOpen;
  card.append(button);
  const profile = root.querySelector('main.w-main > .card');
  if (profile) profile.after(card);
}
