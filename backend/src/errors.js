import { isDateString } from './domain/index.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message); Object.assign(this, {status, code, details});
  }
}
export const fail = (status, code, message, details) => { throw new ApiError(status, code, message, details); };
export function requiredText(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    fail(400, 'INVALID_INPUT', `${label}을(를) 올바르게 입력해 주세요. (최대 ${max}자)`);
  }
  return value.trim();
}
export function dateParam(value) {
  if (!isDateString(value)) {
    fail(400, 'INVALID_DATE', '날짜 형식은 YYYY-MM-DD입니다.');
  }
  return value;
}
export function errorHandler(error, req, res, next) {
  if(req.aborted || res.destroyed) return;
  if (res.headersSent) return next(error);
  if (error.code === 'P2002') return res.status(409).json({error:{code:'CONFLICT',message:'이미 저장된 항목입니다. 화면을 새로고침해 주세요.'}});
  if (error.code === 'P2025') return res.status(404).json({error:{code:'NOT_FOUND',message:'항목을 찾을 수 없습니다.'}});
  if (error.code === 'P2034' || (error.code === 'P2010' && ['40001','40P01'].includes(error.meta?.code))) return res.status(409).json({error:{code:'CONFLICT',message:'동시에 변경된 기록입니다. 새로고침 후 다시 시도해 주세요.'}});
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({error:{code:'FILE_TOO_LARGE',message:'첨부 파일이 허용 크기를 넘었습니다.'}});
  if (error.name === 'MulterError') return res.status(400).json({error:{code:'INVALID_UPLOAD',message:'파일을 한 개씩 선택해 업로드해 주세요.'}});
  if (error instanceof URIError) return res.status(400).json({error:{code:'INVALID_INPUT',message:'주소 형식이 올바르지 않아요.'}});
  if (error.type === 'entity.parse.failed') return res.status(400).json({error:{code:'INVALID_JSON',message:'요청 형식이 올바르지 않습니다.'}});
  const status = error.status || 500;
  if (status >= 500) console.error(JSON.stringify({event:'request_failed',code:error.code || error.name,path:req.path}));
  res.status(status).json({error:{code:error.code || 'INTERNAL_ERROR',message:status >= 500 ? '서버 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' : error.message,...(error.details ? {details:error.details} : {})}});
}
