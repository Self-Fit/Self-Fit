import React,{useEffect,useMemo} from 'react';
import {useResource,AppFrame,ErrorNotice,Loading} from './shared';
import {StudentPage} from './student-ui';
import {HomeScreen,RecordsScreen,SettingsScreen,NotificationsScreen,CorrectionsScreen} from './student-screens';
import RecordPage from './student-record';
import MyChallenges from './challenges/MyChallenges.jsx';
import {getChallengeDashboard,listMyChallenges} from './challenges/index.js';
import {useLoad} from './challenges/ui.jsx';
import {openInvitations,selectedChallengeId} from './challenges/student.js';
import {programOf} from './challenges/program.js';

const ACCOUNT_ROUTES=['/me','/settings','/install','/logout','/notifications'];

export default function StudentApp({mode,user,onLogout,path}) {
  const route=path||window.location.pathname.replace(new RegExp(`^/${mode}`),'')||'/';
  // GET /student/challenges decides which challenge the screens show (the switcher's choice, else the server's current one).
  const mine=useLoad(()=>listMyChallenges(),[route]);
  const challengeId=mine.data?selectedChallengeId(mine.data):undefined;
  const dashboard=useLoad(()=>challengeId?getChallengeDashboard(challengeId):Promise.resolve(null),[challengeId,route]);
  // Without a confirmed challenge there is no dashboard; the bell still needs the unread count.
  const notifications=useResource(mine.data&&!challengeId?'/student/notifications':null,route);
  useEffect(()=>{const refresh=()=>{mine.refresh();dashboard.refresh();};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  const reload=()=>{mine.refresh();dashboard.refresh();};
  const current=dashboard.data?.challenge?.id===challengeId?dashboard.data:null;
  // Screens were built on the legacy dashboard shape ({program,...}); give them that plus the challenge's record path.
  const data=useMemo(()=>current&&{...current,program:programOf(current.challenge),recordsPath:`/student/challenges/${encodeURIComponent(current.challenge.id)}/records`},[current]);
  if(route==='/challenges')return <MyChallenges {...{mode,user,onLogout}} onChange={reload}/>;
  const error=mine.error||(challengeId&&dashboard.error);
  if(error)return <AppFrame {...{mode,user,onLogout}}><StudentPage mode={mode}><ErrorNotice error={error} retry={reload}/></StudentPage></AppFrame>;
  if(!mine.data||(challengeId?!data:!notifications.data&&!notifications.error))return <AppFrame {...{mode,user,onLogout}}><StudentPage mode={mode}><Loading/></StudentPage></AppFrame>;
  if(!data){
    // Not confirmed in any challenge: the home is the invitation list; account screens and notifications still work.
    if(!ACCOUNT_ROUTES.includes(route))return <MyChallenges {...{mode,user,onLogout}} onChange={reload}/>;
    const bare={user:{...user,participating:false},program:null,summary:null,records:[],unreadCount:notifications.data?.unreadCount||0};
    if(route==='/notifications')return <NotificationsScreen {...{mode,onLogout}} data={bare}/>;
    return <SettingsScreen {...{mode,onLogout}} data={bare} mine={mine.data} onSwitchChallenge={reload} settingsOnly={route==='/settings'} install={mode==='mobile'&&route==='/install'} logout={mode==='mobile'&&route==='/logout'}/>;
  }
  if(['/me','/settings','/install','/logout'].includes(route))return <SettingsScreen {...{mode,data,onLogout}} mine={mine.data} onSwitchChallenge={reload} settingsOnly={route==='/settings'} install={mode==='mobile'&&route==='/install'} logout={mode==='mobile'&&route==='/logout'}/>;
  if(route==='/notifications')return <NotificationsScreen {...{mode,data,onLogout}}/>;
  if(route==='/corrections')return <CorrectionsScreen {...{mode,data,onLogout}}/>;
  if(route==='/records')return <RecordsScreen {...{mode,data,onLogout}}/>;
  if(route==='/today'||/^\/records\/\d{4}-\d{2}-\d{2}$/.test(route)){const date=route==='/today'?data.program.today:route.split('/').pop();return <RecordPage key={`${challengeId}:${date}`} mode={mode} date={date} dashboard={data} onChange={dashboard.refresh}/>;}
  return <HomeScreen {...{mode,data,onLogout}} invitations={openInvitations(mine.data).length}/>;
}
