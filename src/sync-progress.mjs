export function syncProgress(pair,status,now=Date.now()) {
  if(!pair)return {...status,active:false};
  const active=pair.expiresAt>now;
  if(!active)return {...status,active:false,phase:'expired',expiresAt:pair.expiresAt,
    message:'同步窗口已过期，未在窗口内完成登录同步。开启代理和停留在“我的”页面不会主动重新登录；请重新开启同步并在官方小程序触发正常登录。'};
  const delayed=now-(pair.openedAt??now)>=60000;
  return {...status,active:true,phase:status.phase??'waiting',expiresAt:pair.expiresAt,
    ...(delayed&&!status.receivedAt?{message:'同步窗口已开启，但尚未收到可验证的微信登录会话，自动重新登录尚未实现。请重新进入官方小程序“我的”，必要时正常登录；仅保持页面打开不能保证产生请求。'}:{})};
}
