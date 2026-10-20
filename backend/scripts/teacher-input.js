import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

/** Reads only explicit human input. No account is created by this helper. */
export async function promptTeacherDetails({input=process.stdin,output=process.stdout,defaults={}}={}) {
  let hidden=false;
  const terminalOutput=new Writable({write(chunk,encoding,callback){if(!hidden) output.write(chunk,encoding);callback();}});
  terminalOutput.isTTY=Boolean(output.isTTY);
  terminalOutput.columns=output.columns || 80;
  const controller=new AbortController();
  const readline=createInterface({input,output:terminalOutput,terminal:true});
  readline.on('SIGINT',()=>controller.abort());
  readline.on('close',()=>controller.abort());
  const question=label=>readline.question(label,{signal:controller.signal});
  const secret=async label=>{
    output.write(label);hidden=true;
    try {return await question('');} finally {hidden=false;output.write('\n');}
  };
  try {
    const studentNumber=defaults.studentNumber || (await question('교사 로그인 ID: ')).trim();
    const name=defaults.name || (await question('교사 이름: ')).trim();
    const password=defaults.password || await secret('비밀번호 (입력 내용 숨김): ');
    if(!defaults.password&&password!==await secret('비밀번호 확인 (입력 내용 숨김): ')) throw new Error('비밀번호가 일치하지 않습니다. 다시 실행해 주세요.');
    return {studentNumber,name,password};
  } finally {readline.close();}
}

export async function readTeacherInput({input=process.stdin,output=process.stdout,env=process.env}={}) {
  const defaults={studentNumber:env.TEACHER_ID,name:env.TEACHER_NAME,password:env.TEACHER_PASSWORD};
  if(input.isTTY) return promptTeacherDetails({input,output,defaults});
  let text='';
  for await(const chunk of input) {text+=chunk;if(Buffer.byteLength(text)>16384) throw new Error('입력이 너무 큽니다.');}
  const supplied=text.trim()?JSON.parse(text):{};
  if(supplied===null||Array.isArray(supplied)||typeof supplied!=='object') throw new Error('stdin에는 교사 정보 JSON 객체를 전달해 주세요.');
  return {...defaults,...supplied};
}
