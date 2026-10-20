import React,{useEffect} from 'react';
import {useResource,useSession,AppFrame,ErrorNotice,Loading,EmptyState} from './shared';
import {StudentPage} from './student-ui';
import {HomeScreen,RecordsScreen,SettingsScreen,NotificationsScreen,EnrollmentScreen,CorrectionsScreen} from './student-screens';
import RecordPage from './student-record';
import MyChallenges from './challenges/MyChallenges.jsx';
import {listMyChallenges} from './challenges/index.js';
import {useLoad} from './challenges/ui.jsx';
import {openInvitations} from './challenges/student.js';

export default function StudentApp({mode,user,onLogout,path}) {
  const route=path||window.location.pathname.replace(new RegExp(`^/${mode}`),'')||'/';
  const dashboard=useResource('/student/dashboard',route);
  // Challenge memberships/invitations (phase 2). Failure only hides the invitation banner and 마이 entry.
  const mine=useLoad(()=>listMyChallenges(),[route]);
  const {refresh:refreshSession}=useSession();
  useEffect(()=>{const refresh=()=>{dashboard.refresh();mine.refresh();};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  const refresh=async()=>{dashboard.refresh();await refreshSession();};
  if(route==='/challenges')return <MyChallenges {...{mode,user,onLogout}} onChange={()=>{mine.refresh();dashboard.refresh();}}/>;
  if(dashboard.error)return <AppFrame {...{mode,user,onLogout}}><StudentPage mode={mode}><ErrorNotice error={dashboard.error} retry={dashboard.refresh}/></StudentPage></AppFrame>;
  if(!dashboard.data)return <AppFrame {...{mode,user,onLogout}}><StudentPage mode={mode}><Loading/></StudentPage></AppFrame>;
  const data=dashboard.data;
  // Since the challenge backend, a student with no current challenge gets program:null.
  // Only account screens and notifications work without one.
  if(!data.program&&!['/me','/settings','/install','/logout','/notifications'].includes(route))return <AppFrame {...{mode,user,onLogout}}><StudentPage mode={mode} title="챌린지"><div className="card"><EmptyState title="지금 참여 중인 챌린지가 없어요.">선생님이 챌린지에 등록하거나 초대하면 알림으로 알려 드려요.</EmptyState></div></StudentPage></AppFrame>;
  if(['/me','/settings','/install','/logout'].includes(route))return <SettingsScreen {...{mode,data,onLogout}} mine={mine.data} settingsOnly={route==='/settings'} install={mode==='mobile'&&route==='/install'} logout={mode==='mobile'&&route==='/logout'}/>;
  if(route==='/notifications')return <NotificationsScreen {...{mode,data,onLogout}}/>;
  if(route==='/corrections')return <CorrectionsScreen {...{mode,data,onLogout}}/>;
  if(route==='/records')return <RecordsScreen {...{mode,data,onLogout}}/>;
  if(route==='/today'||/^\/records\/\d{4}-\d{2}-\d{2}$/.test(route)){const date=route==='/today'?data.program.today:route.split('/').pop();return <RecordPage key={date} mode={mode} date={date} dashboard={data} onChange={dashboard.refresh}/>;}
  if(!data.user.participating)return <EnrollmentScreen {...{mode,data,onLogout}} onChange={refresh}/>;
  return <HomeScreen {...{mode,data,onLogout}} invitations={openInvitations(mine.data).length}/>;
}
