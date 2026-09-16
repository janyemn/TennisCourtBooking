import {randomBytes,timingSafeEqual} from 'node:crypto';
export function newPairing(identity,now=Date.now()) {
  if(identity!=='市民')throw Error('当前仅支持已配置的市民账号同步');
  return {identity,token:randomBytes(32).toString('hex'),openedAt:now,expiresAt:now+600000};
}
export function syncCandidate(base,pairing,input,token,now=Date.now()) {
  if(!pairing||pairing.expiresAt<=now||typeof token!=='string'||token.length!==pairing.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(pairing.token)))throw Error('同步未开启或配对已过期');
  if(input.origin!=='https://nswtt.rim20.com'||!['/api/wtt/user/wttauth/login','/api/wtt/user/wttauth/info'].includes(input.path))throw Error('不是目标小程序登录会话');
  const headers={};
  for(const name of ['cookie','app-version','referer','user-agent','x-page-uuid']) {
    const value=input.headers?.[name];if(typeof value==='string'&&value.length<=8192&&!/[\r\n]/.test(value))headers[name]=value;
  }
  if(!headers.referer?.startsWith(`https://servicewechat.com/${base.appid}/`)||!/(?:^|;\s*)sid=[^;\s]+/.test(headers.cookie??''))throw Error('小程序标识或会话缺失');
  const candidate={...base,headers,syncedAt:new Date(now).toISOString()};
  delete candidate.cookieExpiries;delete candidate.cookieUpdatedAt;
  return candidate;
}
