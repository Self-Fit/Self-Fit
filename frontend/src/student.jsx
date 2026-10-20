import React,{useEffect} from 'react';
import {useResource,useSession,AppFrame,ErrorNotice,Loading} from './shared';
import {StudentPage} from './student-ui';
import {HomeScreen,RecordsScreen,SettingsScreen,NotificationsScreen,EnrollmentScreen,CorrectionsScreen} from './student-screens';
import RecordPage from './student-record';

export default function StudentApp({mode,user,onLogout,path}) {
  const route=path||window.location.pathname.replace(new RegExp(`^/${mode}`),'')||'/';
  const dashboard=useResource('/student/dashboard',route);
  const {refresh:refreshSession}=useSession();
  useEffect(()=>{const refresh=()=>dashboard.refresh();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  const refresh=async()=>{dashboard.refresh();await refreshSession();};
  if(dashboard.error)return <AppFrame {...{mode,user,onLogout}}><StudentPage mode={mode}><ErrorNotice error={dashboard.error} retry={dashboard.refresh}/></StudentPage></AppFrame>;
  if(!dashboard.data)return <AppFrame {...{mode,user,onLogout}}><StudentPage mode={mode}><Loading/></StudentPage></AppFrame>;
  const data=dashboard.data;
  if(['/me','/settings','/install','/logout'].includes(route))return <SettingsScreen {...{mode,data,onLogout}} settingsOnly={route==='/settings'} install={mode==='mobile'&&route==='/install'} logout={mode==='mobile'&&route==='/logout'}/>;
  if(route==='/notifications')return <NotificationsScreen {...{mode,data,onLogout}}/>;
  if(route==='/corrections')return <CorrectionsScreen {...{mode,data,onLogout}}/>;
  if(route==='/records')return <RecordsScreen {...{mode,data,onLogout}}/>;
  if(route==='/today'||/^\/records\/\d{4}-\d{2}-\d{2}$/.test(route)){const date=route==='/today'?data.program.today:route.split('/').pop();return <RecordPage key={date} mode={mode} date={date} dashboard={data} onChange={dashboard.refresh}/>;}
  if(!data.user.participating)return <EnrollmentScreen {...{mode,data,onLogout}} onChange={refresh}/>;
  return <HomeScreen {...{mode,data,onLogout}}/>;
}
