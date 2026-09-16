import http from 'node:http';
import {visibleJobs,deleteJobRecords} from '../src/job-records.mjs';
import {bindCitizen} from '../src/onboarding.mjs';
import {NswttTransport} from '../src/nswtt-transport.mjs';
import {syncProgress} from '../src/sync-progress.mjs';
import {createLoginPreflight} from '../src/login-preflight.mjs';
import {syncDiagnostics} from '../src/sync-diagnostics.mjs';
import {filterCourts} from '../src/court-plan.mjs';
import {newPairing,syncCandidate} from '../src/session-sync.mjs';
import {venues,getVenue,venueProfile,jobVenue} from '../src/venues.mjs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { NswttAdapter } from '../src/nswtt-adapter.mjs';
import { Journal, reserve, chooseCourt } from '../src/engine.mjs';
import { reconcileJobRecords, applyReconciliation, orderJobStatuses } from '../src/reconcile.mjs';
import { persistSessionRotation, replaceSession } from '../src/session-store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'app', 'public');
const LOCAL = join(ROOT, '.local');
const STATE_PATH = join(LOCAL, 'app-state.json');
const PORT = 3827;
await mkdir(LOCAL, { recursive: true });
let running = false;
let syncPair=null,syncBusy=false;
let syncStatus={message:'未开启会话同步'};
const SYNC_PAIR_PATH=join(LOCAL,'session-sync-pair.json');
const profilePath = identity => join(LOCAL, identity === '师生' ? 'profile-student.json' : 'profile.json');
const sessionPath = identity => join(LOCAL, identity === '师生' ? 'session-student.json' : 'session.json');
const sessionHealth = {};
const sessionChecks = new Map();
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const publicConfig=await readJson(join(ROOT,'config','nswtt-public.json'));
async function initializeCitizen(candidate){
  if(await exists(profilePath('市民')))throw Error('本机已经绑定账号，不能覆盖');
  const profile=await bindCitizen(publicConfig.profile,candidate,new NswttTransport(candidate));
  await replaceSession(sessionPath('市民'),candidate);
  await writeFile(profilePath('市民'),JSON.stringify(profile,null,2),{flag:'wx',mode:0o600});
}
try{
  const savedPair=await readJson(SYNC_PAIR_PATH);
  if(savedPair.identity==='市民'&&/^[a-f0-9]{64}$/.test(savedPair.token)&&Number.isFinite(savedPair.expiresAt)){
    syncPair=savedPair;syncStatus={message:'已恢复会话同步窗口，等待官方登录请求；尚未验证登录',phase:'waiting'};
  }
}catch(error){if(error.code!=='ENOENT')console.error('无法恢复会话同步窗口');}
const exists = async path => { try { await readFile(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
let state = await (async () => { try { return await readJson(STATE_PATH); } catch (e) { if (e.code === 'ENOENT') return { jobs: [] }; throw e; } })();
let saving = Promise.resolve();
const eventClients = new Set();
function publishJobs() {
  const frame=`data: ${JSON.stringify(visibleJobs(state.jobs).map(publicJob).reverse())}\n\n`;
  for(const client of eventClients) if(client.destroyed || !client.write(frame)) {eventClients.delete(client);client.end();}
}
const save = () => saving = saving.then(async () => { await mkdir(LOCAL, { recursive: true }); await writeFile(STATE_PATH, JSON.stringify(state, null, 2)); publishJobs(); });
const publicJob = j => ({ id:j.id, allowSwitch:!!j.allowSwitch,includePremium:!!j.includePremium, identity:j.identity, venue:jobVenue(j), venueName:getVenue(jobVenue(j)).name, date:j.date, start:j.start, end:j.end, runAt:j.runAt,
  repeatDaily:!!j.repeatDaily, status:j.status, message:j.message, result:j.result, timing:j.timing,loginPreparation:j.loginPreparation });
function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options':'nosniff',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
async function body(req) {
  let size=0, chunks=[]; for await (const chunk of req) { size += chunk.length; if (size > 55*1024*1024) throw Error('请求文件超过55MB'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function validateSelection(v) {
  if (!['市民','师生'].includes(v.identity) || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.end)) throw Error('预约参数无效');
  const venue=getVenue(v.venue);
  const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3)); const duration=mins(v.end)-mins(v.start);
  if (duration < 60 || duration > venue.maxMinutes || duration % 30) throw Error('预约时长须按半小时选择；大学城最多2小时，大沙河最多4小时');
}
async function adapterFor(identity,venue='campus') {
  if (!await exists(profilePath(identity)) || !await exists(sessionPath(identity))) throw Error(`${identity}流程尚未接入本人会话`);
  return new NswttAdapter(venueProfile(await readJson(profilePath(identity)),venue), await readJson(sessionPath(identity)), { onSessionUpdate: persistSessionRotation(sessionPath(identity)) });
}
async function checkSession(identity) {
  if (!['市民','师生'].includes(identity)) throw Error('请选择订场身份');
  if (sessionChecks.has(identity)) return sessionChecks.get(identity);
  const request=(async()=>{
    try {
      const adapter=await adapterFor(identity);await adapter.waitForLogin();
      sessionHealth[identity]={status:'valid',checkedAt:new Date().toISOString(),message:'登录有效，无需重新导入HAR',cookieUpdatedAt:adapter.session.cookieUpdatedAt??null};
    } catch(error) {
      sessionHealth[identity]={status:error.code==='SESSION_REQUIRED'?'expired':'error',checkedAt:new Date().toISOString(),message:error.message};
    }
    return sessionHealth[identity];
  })();
  sessionChecks.set(identity,request);
  try{return await request;}finally{sessionChecks.delete(identity);}
}
async function checkSlots(v) {
  validateSelection(v); const adapter=await adapterFor(v.identity,v.venue); await adapter.waitForLogin(); await adapter.prepare();
  const slots=await adapter.listSlots({date:v.date}); const names=new Map(adapter.project.placelist.map(p=>[p.id,p.name]));
  const choice=chooseCourt(filterCourts(slots,adapter.profile,v.includePremium===true),v.start,v.end,v.allowSwitch===true);
  return { configured:true, identity:v.identity, date:v.date, targetAvailable:!!choice,
    targetCourt:choice?choice.segments?choice.segments.map(s=>`${names.get(s.courtId)} ${s.start}–${s.end}`).join(' → '):names.get(choice.courtId)||choice.courtId:null,
    available:filterCourts(slots,adapter.profile,v.includePremium===true).filter(s=>s.available).map(s=>({court:names.get(s.courtId)||s.courtId,start:s.start,end:s.end})) };
}
async function reconcileDate(v) {
  const adapter=await adapterFor(v.identity,v.venue),profile=adapter.profile;
  const key=createHash('sha256').update(JSON.stringify([profile.origins.slice().sort(),String(profile.target.accountId)])).digest('hex').slice(0,20);
  const path=join(LOCAL,'orders',key,...((v.venue??'campus')==='campus'?[]:[v.venue]),`${v.date}.json`),journal=new Journal(path);
  const previous=await journal.read();
  const jobs=state.jobs.filter(j=>j.identity===v.identity&&j.date===v.date&&jobVenue(j)===(v.venue??'campus'));
  const result=await reconcileJobRecords(adapter,previous,jobs);
  if(!result.clear)return {message:result.reason};
  const archive=join(LOCAL,'orders',key,'history');await mkdir(archive,{recursive:true});
  const archiveName=`${v.date}-${Date.now()}-${randomUUID()}`;
  await writeFile(join(archive,archiveName+'-verification.json'),JSON.stringify(result),{mode:0o600});
  if(previous)await rename(path,join(archive,archiveName+'.json'));
  applyReconciliation(jobs,result);await save();
  return {message:'官方已确认旧订单取消或过期，网页任务状态已同步。现在可以重新预约；未自动下单。'};
}
async function runJob(job) {
  if (job.status !== 'scheduled' || running) return;
  running = true; job.status='running'; job.message='正在查询空位并锁场'; await save();
  try {
    // Finish a background login check before creating an adapter with the latest cookies.
    if(sessionChecks.has(job.identity)) await sessionChecks.get(job.identity);
    const adapter=await adapterFor(job.identity,jobVenue(job));
    const profile=adapter.profile;
    const startedAt=Date.now();
    job.timing={...job.timing,startedAt:new Date(startedAt).toISOString(),requests:[]};
    const request=adapter.client.request.bind(adapter.client);
    adapter.client.request=async(path,...args)=>{
      const start=performance.now();
      const offsetMs=Date.now()-Date.parse(job.runAt);
      try{return await request(path,...args);}finally{
        job.timing.requests.push({path,ms:Math.round(performance.now()-start),offsetMs});
      }
    };
    const phaseLabels={preparing:'正在提前检查登录、场馆和参与人',waiting:'准备完成，等待预约时间',querying:'正在查询实时空场',validating:'正在校验价格和待付款订单',submitting:'正在提交并核实订单',held:'已确认锁场，正在申请支付'};
    const onPhase=phase=>{
      job.message=phaseLabels[phase];
      if(phase==='waiting')job.timing.preparedAt=new Date().toISOString();
      if(phase==='querying'&&!job.timing.queryStartedAt)job.timing.queryStartedAt=new Date().toISOString();
      if(phase==='held') {
        job.timing.lockMs=Date.now()-Date.parse(job.timing.queryStartedAt);
        job.timing.sinceDueMs=Date.now()-Date.parse(job.runAt);
        if(job.timing.acceptedAt)job.timing.totalMs=Date.now()-Date.parse(job.timing.acceptedAt);
      }
      publishJobs();
    };
    const key=createHash('sha256').update(JSON.stringify([profile.origins.slice().sort(),String(profile.target.accountId)])).digest('hex').slice(0,20);
    const journal=new Journal(join(LOCAL,'orders',key,...(jobVenue(job)==='campus'?[]:[jobVenue(job)]),`${job.date}.json`));
    const lines=[]; const hold=await reserve({adapter,journal,release:new Date(job.runAt),selection:{date:job.date,start:job.start,end:job.end,allowSwitch:job.allowSwitch===true,includePremium:job.includePremium===true},identity:job.identity,
      waitUntil:async d=>{while(d.getTime()>Date.now())await new Promise(r=>setTimeout(r,d.getTime()-Date.now()));},askPayment:async()=>false,windowMs:60000,log:m=>lines.push(m),onPhase});
    job.status=hold?'payment_pending':'no_slot'; job.message=hold?'订单已锁场，等待电脑微信发起支付；尚未发送到手机':'未找到符合场地偏好的完整连续时段';
    if (hold) job.result={orderId:hold.orderId,date:hold.date,courtId:hold.courtId,segments:hold.segments?.map(s=>({...s,court:adapter.project.placelist.find(p=>p.id===s.courtId)?.name})),court:adapter.project.placelist.find(p=>p.id===hold.courtId)?.name,start:hold.start,end:hold.end,expiresAt:hold.expiresAt};
    if (hold) {
      await save();
      try {
        const payment=await adapter.applyPayment(hold);
        await mkdir(join(LOCAL,'payments'),{recursive:true});
        await writeFile(join(LOCAL,'payments',`${job.id}.json`),JSON.stringify(payment),{mode:0o600});
        job.status='payment_ready';
        job.message='已锁场并申请微信支付；尚未接通微信收银台，未发送到手机';
      } catch(error) {
        job.status='payment_failed';
        job.message=`订单已锁场，但支付申请未完成：${error.message}。不要重复下单。`;
      }
    }
  } catch(e) { job.status='failed'; job.message=e.code==='SESSION_REQUIRED'?'开抢前登录验证失败，未提交订单。代理同步窗口不能主动重新登录微信；请在官方小程序正常登录并确认会话同步成功。':String(e.message||e); }
  if(job.repeatDaily) {
    const plus=s=>new Date(new Date(s).getTime()+86400000).toISOString();
    const date=new Date(`${job.date}T00:00:00+08:00`); date.setUTCDate(date.getUTCDate()+1);
    state.jobs.push({...job,id:randomUUID(),date:new Date(date.getTime()+8*3600000).toISOString().slice(0,10),runAt:plus(job.runAt),status:'scheduled',message:'等待执行',result:undefined,timing:undefined,loginPreparation:undefined,deletedAt:undefined});
  }
  await save();
  running = false;
}
const prepareLogin=createLoginPreflight({check:checkSession,save,openSync:async job=>{
  if(running||syncBusy)throw Error('服务正忙，请手动开启会话同步');
  const expiry=Date.parse(job.runAt)-10000;
  if(expiry<=Date.now())throw Error('已进入开抢准备阶段');
  if(syncPair&&syncPair.expiresAt>Date.now()&&syncPair.identity!==job.identity)throw Error('其他身份正在同步');
  const pair=syncPair&&syncPair.expiresAt>Date.now()?{...syncPair}:newPairing(job.identity);
  pair.expiresAt=expiry;
  pair.openedAt=Date.now();
  await writeFile(SYNC_PAIR_PATH,JSON.stringify(pair),{mode:0o600});syncPair=pair;
  syncStatus={message:'已在预约前20分钟自动开启同步（无论旧会话是否有效）。请保持同步助手和代理运行，打开官方微信小程序“我的”；如需登录请正常登录。同步成功后停止接收，最晚在开抢准备前关闭。'};
  return '已开启会话同步，请在官方微信重新登录并打开“我的”（需要同步助手及代理已配置）';
}});
setInterval(()=>{
  const now=Date.now();
  if(syncPair){
    const progress=syncProgress(syncPair,syncStatus,now);
    for(const job of state.jobs)if(job.status==='scheduled'&&job.identity===syncPair.identity&&job.loginPreparation&&
      job.loginPreparation.status!=='valid'&&now-(syncPair.openedAt??now)>=60000&&job.message!==progress.message){
      job.message=progress.message;void save().catch(error=>console.error(error.message));
    }
  }
  if(!running)void prepareLogin(state.jobs).catch(error=>console.error('提前登录检查失败：',error.message));
  if(!running)for(const identity of ['市民','师生']){
    const jobs=state.jobs.filter(j=>j.status==='scheduled'&&j.identity===identity&&Date.parse(j.runAt)>now+15000);
    const health=sessionHealth[identity];
    const next=jobs.length?Math.min(...jobs.map(j=>Date.parse(j.runAt))):Infinity;
    // Low frequency while waiting; refresh once more roughly two minutes before execution.
    const age=now-Date.parse(health?.checkedAt??'1970-01-01');
    if(jobs.length&&health?.status!=='expired'&&!sessionChecks.has(identity)&&
      (age>=5*60000||(next-now<=120000&&age>=120000)))void checkSession(identity);
  }
  for(const job of state.jobs) if(job.status==='scheduled' && Date.parse(job.runAt)<=now+10000) {
    if(now-Date.parse(job.runAt)>60000){job.status='missed';job.message='执行时间已错过超过60秒';save();}
    else runJob(job);
  }
},100).unref();

const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    const origin=req.headers.origin; if(origin && !/^http:\/\/(127\.0\.0\.1|localhost):3827$/.test(origin)) return send(res,403,{error:'拒绝跨站请求'});
    if(!['127.0.0.1:3827','localhost:3827'].includes(req.headers.host)) return send(res,403,{error:'拒绝非本机请求'});
    if(req.method==='POST'&&!String(req.headers['content-type']).startsWith('application/json'))return send(res,415,{error:'仅接受JSON请求'});
    if(req.method==='GET'&&url.pathname==='/api/session-sync/status')return send(res,200,{...syncProgress(syncPair,syncStatus),diagnostics:await syncDiagnostics()});
    if(req.method==='POST'&&url.pathname==='/api/session-sync/start'){
      if(running||syncBusy)throw Error('任务正在执行，请稍后开启同步');
      const v=await body(req);if(v.identity!=='市民')throw Error('师生预约使用校园系统，尚未完成接入');
      syncPair=newPairing(v.identity);
      await writeFile(SYNC_PAIR_PATH,JSON.stringify(syncPair),{mode:0o600});
      syncStatus={message:'已开启10分钟同步窗口。请启动同步助手，在官方小程序正常登录后打开“我的”。'};
      return send(res,200,syncStatus);
    }
    if(req.method==='POST'&&url.pathname==='/api/session-sync/stop'){
      syncPair=null;await writeFile(SYNC_PAIR_PATH,'{}',{mode:0o600});syncStatus={message:'已停止同步'};return send(res,200,syncStatus);
    }
    if(req.method==='POST'&&url.pathname==='/api/session-sync/receive'){
      const input=await body(req),pair=syncPair;
      if(!pair)throw Error('未开启同步');
      const firstBinding=!await exists(profilePath(pair.identity));
      const base=await exists(sessionPath(pair.identity))?await readJson(sessionPath(pair.identity)):structuredClone(publicConfig.session);
      const candidate=syncCandidate(base,pair,input,req.headers['x-sync-token']);
      if(running||syncBusy)return send(res,409,{error:'正在执行任务，请稍后重新打开官方个人页'});
      syncStatus={message:'已收到微信会话，正在向平台验证本人登录；尚未确认成功',phase:'verifying',receivedAt:Date.now()};
      syncBusy=true;running=true;
      try{
        if(sessionChecks.has(pair.identity))await sessionChecks.get(pair.identity);
        if(!firstBinding){const adapter=new NswttAdapter(await readJson(profilePath(pair.identity)),candidate);await adapter.waitForLogin();}
        if(syncPair!==pair||pair.expiresAt<=Date.now())throw Error('同步窗口已关闭，请重新开启');
        // A concurrent HAR import or cookie rotation must never be overwritten.
        if(firstBinding)await initializeCitizen(candidate);
        else await persistSessionRotation(sessionPath(pair.identity))(base,candidate);
        sessionHealth[pair.identity]={status:'valid',checkedAt:new Date().toISOString(),message:'官方登录会话已同步并验证'};
        for(const job of state.jobs)if(job.status==='scheduled'&&job.identity===pair.identity&&job.loginPreparation){
          job.loginPreparation={status:'valid',checkedAt:new Date().toISOString(),message:'官方登录会话已同步并验证，等待执行'};
          job.message=job.loginPreparation.message;
        }
        await save();
        syncPair=null;await writeFile(SYNC_PAIR_PATH,'{}',{mode:0o600});
        syncStatus={message:'本人登录已验证，会话同步成功，无需导入HAR。',syncedAt:new Date().toISOString()};
        return send(res,200,syncStatus);
      }catch(error){syncStatus={message:'已收到会话，但平台验证未通过：'+error.message,phase:'rejected',receivedAt:Date.now()};throw error;}
      finally{syncBusy=false;running=false;}
    }
    if(req.method==='GET' && url.pathname==='/api/events') {
      res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'});
      res.write(`data: ${JSON.stringify(visibleJobs(state.jobs).map(publicJob).reverse())}\n\n`);
      eventClients.add(res);
      const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
      res.on('close',()=>{clearInterval(heartbeat);eventClients.delete(res);});
      return;
    }
    if(req.method==='GET' && url.pathname==='/api/bootstrap') {
      return send(res,200,{now:new Date().toISOString(),sessionHealth,venues:venues.map(({id,name,releaseAt,maxMinutes})=>({id,name,releaseAt,maxMinutes})),configured:{'市民':await exists(profilePath('市民'))&&await exists(sessionPath('市民')),'师生':await exists(profilePath('师生'))&&await exists(sessionPath('师生'))},jobs:visibleJobs(state.jobs).map(publicJob).reverse()});
    }
    if(req.method==='POST'&&url.pathname==='/api/session/check'){
      const v=await body(req);return send(res,200,await checkSession(v.identity));
    }
    if(req.method==='POST' && url.pathname==='/api/check') return send(res,200,await checkSlots(await body(req)));
    if(req.method==='POST' && url.pathname==='/api/reconcile') {
      if(running)throw Error('有预约正在执行，请等待结束后再核对');
      const v=await body(req);validateSelection(v);
      running=true;
      try{
        return send(res,200,await reconcileDate(v));
      }finally{running=false;}
    }
    if(req.method==='POST' && url.pathname==='/api/jobs') {
      const acceptedAt=new Date().toISOString();
      const v=await body(req); validateSelection(v); if(!await exists(profilePath(v.identity))||!await exists(sessionPath(v.identity))) throw Error(`${v.identity}流程尚未接入`);
      if(running)throw Error('正在执行预约或核对订单，请稍后重试');
      running=true;
      try {
      if(state.jobs.some(j=>j.identity===v.identity&&j.date===v.date&&jobVenue(j)===(v.venue??'campus')&&['scheduled','running'].includes(j.status)))throw Error('这一天已有等待中或执行中的任务，请先处理');
      // Reconcile before calculating an immediate run time: network checks may take seconds.
      const reconciliationStart=performance.now();
      await reconcileDate(v);
      const reconciliationMs=Math.round(performance.now()-reconciliationStart);
      const runAt=v.mode==='now'?new Date():new Date(v.runAt); if(!Number.isFinite(runAt.getTime())||runAt.getTime()<Date.now()-2000) throw Error('执行时间必须是当前或未来时间');
      if(state.jobs.some(j=>j.identity===v.identity&&j.date===v.date&&jobVenue(j)===(v.venue??'campus')&&['scheduled','running',...orderJobStatuses].includes(j.status)))throw Error('这一天已有任务或待付款订单，请先处理，避免重复订场');
      const job={id:randomUUID(),identity:v.identity,allowSwitch:v.allowSwitch===true,includePremium:v.includePremium===true,venue:v.venue??'campus',date:v.date,start:v.start,end:v.end,runAt:runAt.toISOString(),repeatDaily:!!v.repeatDaily,status:'scheduled',message:'等待执行',timing:{acceptedAt,reconciliationMs,immediate:v.mode==='now'}};
      state.jobs.push(job);await save();return send(res,201,publicJob(job));
      }finally{running=false;}
    }
    if(req.method==='POST'&&url.pathname==='/api/jobs/delete'){
      if(running||syncBusy)throw Error('任务正在执行，请稍后删除记录');
      const v=await body(req);
      const count=deleteJobRecords(state.jobs,v.ids);await save();
      return send(res,200,{count,message:'所选记录已从列表删除；官方订单未取消，防重复提交记录保留'});
    }
    const cancel=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/);
    if(req.method==='POST'&&cancel){const j=state.jobs.find(x=>x.id===cancel[1]);if(!j) return send(res,404,{error:'任务不存在'});if(j.status!=='scheduled')throw Error('只能取消等待中的任务');j.status='cancelled';j.message='已取消';await save();return send(res,200,publicJob(j));}
    if(req.method==='POST'&&url.pathname==='/api/import-har'){
      const v=await body(req);if(!['市民','师生'].includes(v.identity)||!v.har?.log?.entries)throw Error('HAR格式或身份无效');
      const entries=v.har.log.entries.filter(e=>{try{const u=new URL(e.request.url);return u.origin==='https://nswtt.rim20.com'&&u.pathname.startsWith('/api/wtt/');}catch{return false;}});
      const allowed=['cookie','app-version','x-page-uuid','referer','user-agent'];const e=[...entries].reverse().find(e=>e.request.headers.some(h=>h.name.toLowerCase()==='cookie'&&h.value));if(!e)throw Error('HAR中没有目标小程序会话');
      if(v.identity!=='市民')throw Error('师生预约尚未接入，请勿导入市民会话作为师生登录');
      const base=await exists(sessionPath(v.identity))?await readJson(sessionPath(v.identity)):structuredClone(publicConfig.session);base.headers=Object.fromEntries(e.request.headers.filter(h=>allowed.includes(h.name.toLowerCase())).map(h=>[h.name.toLowerCase(),h.value]));
      delete base.cookieExpiries;delete base.cookieUpdatedAt;
      if(!await exists(profilePath(v.identity))){
        if(running||syncBusy)throw Error('服务正忙，请稍后绑定');
        running=true;
        try{await initializeCitizen(base);return send(res,200,{ok:true,message:'本机已绑定你本人的实名市民账号'});}
        finally{running=false;}
      }
      if(await exists(profilePath(v.identity))){
        const candidate=new NswttAdapter(await readJson(profilePath(v.identity)),base);
        await candidate.waitForLogin();
      }
      base.importedAt=new Date().toISOString();
      await replaceSession(sessionPath(v.identity),base);delete sessionHealth[v.identity];
      return send(res,200,{ok:true,message:v.identity==='师生'&&!await exists(profilePath('师生'))?'师生会话已保存，仍需完成师生项目映射':'会话已验证并更新；后续服务器下发的新Cookie会自动保存'});
    }
    if(req.method==='GET'){
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','styles.css'].includes(file))return send(res,404,{error:'未找到'});
      const data=await readFile(join(PUBLIC,file));const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)];return send(res,200,data,mime);
    }
    send(res,404,{error:'未找到'});
  }catch(e){send(res,400,{error:String(e.message||e)});}
});
server.on('error',error=>{
  if(error.code==='EADDRINUSE'&&process.argv.includes('--open')) {
    spawn('rundll32.exe',['url.dll,FileProtocolHandler',`http://127.0.0.1:${PORT}`],{detached:true,stdio:'ignore'}).unref();
    process.exit(0);
  }
  console.error(error.message);process.exit(1);
});
server.listen(PORT,'127.0.0.1',()=>{
  console.log(`预约应用已启动：http://127.0.0.1:${PORT}`);
  if(process.argv.includes('--open')) spawn('rundll32.exe',['url.dll,FileProtocolHandler',`http://127.0.0.1:${PORT}`],{detached:true,stdio:'ignore'}).unref();
});
