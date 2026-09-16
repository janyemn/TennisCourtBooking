const $=s=>document.querySelector(s), api=async(path,options={})=>{
  let r;
  try{r=await fetch(path,{headers:{'content-type':'application/json'},...options});}
  catch{throw Error('无法连接本地预约服务。请双击 start-app.cmd 启动后刷新；若正在使用代理，请将 localhost 和 127.* 设为绕过。提交后断线时先查看任务和官方订单，不要连续重复提交。');}
  let j;try{j=await r.json();}catch{throw Error('服务响应中断或格式异常，请重新连接并核对任务状态。');}
  if(!r.ok)throw Error(j.error||'请求失败');return j;
};
const identity=()=>document.querySelector('input[name=identity]:checked').value;
const pad=n=>String(n).padStart(2,'0'), localValue=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
for(let m=0;m<=23*60+30;m+=30){const t=`${pad(Math.floor(m/60))}:${pad(m%60)}`;$('#start').add(new Option(t,t));if(m>=30)$('#end').add(new Option(t,t));}
$('#start').value='19:00';$('#end').value='21:00';const tomorrow=new Date(Date.now()+86400000);$('#date').value=`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`;const run=new Date(tomorrow);run.setDate(run.getDate()-1);run.setHours(22,0,0,0);$('#runAt').value=localValue(run);
const payload=()=>({identity:identity(),allowSwitch:$('#allow-switch').checked,includePremium:$('#include-premium').checked,venue:$('#venue').value,date:$('#date').value,start:$('#start').value,end:$('#end').value,runAt:new Date($('#runAt').value).toISOString(),repeatDaily:$('#repeat').checked});
function message(el,text,error=false){el.textContent=text;el.classList.toggle('error',error)}
const labels={expired:'订单已过期',order_cancelled:'订单已取消',scheduled:'等待执行',running:'正在锁场',held:'已锁场，未发送支付',payment_pending:'正在申请支付',payment_ready:'支付已申请，未发送手机',payment_sent:'电脑已发送，待手机确认',payment_failed:'支付申请未完成',no_slot:'无完整空位',failed:'执行失败',missed:'已错过',cancelled:'已取消'};
const selectedJobs=new Set();
let deletableJobs=[];
function updateDeletionControls(){
  $('#delete-jobs').disabled=!selectedJobs.size;
  $('#delete-jobs').textContent='删除选中记录（'+selectedJobs.size+'）';
  $('#select-all-jobs').checked=!!deletableJobs.length&&deletableJobs.every(id=>selectedJobs.has(id));
  $('#select-all-jobs').indeterminate=selectedJobs.size>0&&!$('#select-all-jobs').checked;
}
function renderJobs(jobs){
deletableJobs=jobs.filter(j=>!['scheduled','running'].includes(j.status)).map(j=>j.id);
for(const id of selectedJobs)if(!deletableJobs.includes(id))selectedJobs.delete(id);
updateDeletionControls();
const el=$('#jobs');if(!jobs.length){el.className='jobs empty';el.textContent='暂无任务';return}el.className='jobs';el.innerHTML=jobs.map(j=>`<article class="job"><div>${!['scheduled','running'].includes(j.status)?'<label class="repeat"><input class="select-job" type="checkbox" data-id="'+escapeHtml(j.id)+'" '+(selectedJobs.has(j.id)?'checked':'')+'>选择记录</label>':''}<strong>${escapeHtml(j.venueName||'深圳大学城体育中心')} · ${j.identity} · ${j.date} ${j.start}–${j.end}</strong><p>${escapeHtml(j.message||'')} · 执行于 ${new Date(j.runAt).toLocaleString()}</p>${j.result?.segments?.length?'<p>'+j.result.segments.map(s=>`${escapeHtml(s.court||s.courtId)} ${escapeHtml(s.start)}–${escapeHtml(s.end)}`).join(' → ')+'</p>':''}${j.loginPreparation?'<p>提前登录检查（'+escapeHtml(new Date(j.loginPreparation.checkedAt).toLocaleString())+'）：'+escapeHtml(j.loginPreparation.message)+'</p>':''}${timingHtml(j.timing)}${j.status==='scheduled'?`<button class="link cancel" data-id="${j.id}">取消任务</button>`:''}</div><span class="status ${j.status}">${labels[j.status]||j.status}</span></article>`).join('');document.querySelectorAll('.select-job').forEach(b=>b.onchange=()=>{if(b.checked)selectedJobs.add(b.dataset.id);else selectedJobs.delete(b.dataset.id);updateDeletionControls()});document.querySelectorAll('.cancel').forEach(b=>b.onclick=async()=>{await api(`/api/jobs/${b.dataset.id}/cancel`,{method:'POST',body:'{}'});load()})}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function timingHtml(t){
  if(!t)return '';
  const lock=Number.isFinite(t.lockMs)?`查询至确认锁场 ${(t.lockMs/1000).toFixed(2)} 秒；距执行时间 ${(t.sinceDueMs/1000).toFixed(2)} 秒`:'';
  const names={'wtt/user/wttauth/info':'登录检查','wtt/sport/project/info':'场馆规则','wtt/user/playerstore/list':'参与人检查','wtt/sport/order/list':'订单检查','wtt/sport/slice/list':'空场查询','wtt/sport/order/check':'价格校验','wtt/sport/order/add':'提交订单','wtt/sport/order/info':'核实订单','wtt/sport/order/payapply':'申请支付'};
  const total=t.immediate&&Number.isFinite(t.totalMs)?`服务端收到请求至锁场 ${(t.totalMs/1000).toFixed(2)} 秒；`:'';
  const reconcile=Number.isFinite(t.reconciliationMs)?`<div>启动前旧订单核对：${t.reconciliationMs} 毫秒</div>`:'';
  const stamp=value=>new Date(value).toLocaleTimeString('zh-CN',{hour12:false,fractionalSecondDigits:3});
  const timeline=[['开始准备',t.startedAt],['准备完成',t.preparedAt],['首次查场',t.queryStartedAt]].filter(([,v])=>v).map(([label,v])=>`${label}：${stamp(v)}`).join('；');
  const groups=[['执行时间前发起的准备请求',r=>Number.isFinite(r.offsetMs)&&r.offsetMs<0],['执行时间起发起的请求',r=>Number.isFinite(r.offsetMs)&&r.offsetMs>=0],['旧记录（未记录逐项起始时间）',r=>!Number.isFinite(r.offsetMs)]];
  const details=groups.map(([label,predicate])=>{const rows=(t.requests||[]).filter(predicate);return rows.length?`<p><strong>${label}</strong></p>${rows.map(r=>`<div>${escapeHtml(names[r.path]||'接口请求')}：${Number(r.ms)} 毫秒${Number.isFinite(r.offsetMs)?`（计划时间${r.offsetMs<0?'前':'后'} ${Math.abs(r.offsetMs)} 毫秒发起）`:''}</div>`).join('')}`:''}).join('');
  return `<p>${escapeHtml(timeline)}</p><p>${escapeHtml(total+lock)}</p><details><summary>查看各步骤耗时</summary>${reconcile}${details}</details>`;
}
async function load(){try{const d=await api('/api/bootstrap');$('#server').textContent='本地服务已连接';$('#server').classList.add('ok');$('#citizenState').textContent=d.configured['市民']?'已接入':'未接入';$('#studentState').textContent='待真实师生流程接入';const health=d.sessionHealth?.[identity()];message($('#session-health'),health?`${health.message}；最近检查：${new Date(health.checkedAt).toLocaleString()}`:'尚未检查当前身份登录状态',!!health&&health.status!=='valid');renderJobs(d.jobs)}catch(e){$('#server').textContent='连接失败';message($('#formMessage'),e.message,true)}}
$('#refresh').onclick=load;
$('#session-check').onclick=async()=>{const b=$('#session-check');b.disabled=true;try{message($('#session-health'),'正在检查登录…');await api('/api/session/check',{method:'POST',body:JSON.stringify({identity:identity()})});await load();}catch(e){message($('#session-health'),e.message,true)}finally{b.disabled=false}};
$('#reconcile').onclick=async()=>{const b=$('#reconcile');b.disabled=true;try{message($('#reconcileMessage'),'正在核对官方订单，请稍候…');const d=await api('/api/reconcile',{method:'POST',body:JSON.stringify({identity:identity(),allowSwitch:$('#allow-switch').checked,includePremium:$('#include-premium').checked,venue:$('#venue').value,date:$('#date').value,start:$('#start').value,end:$('#end').value})});message($('#reconcileMessage'),d.message);await load();}catch(e){message($('#reconcileMessage'),e.message,true)}finally{b.disabled=false}};
$('#book-now').onclick=async()=>{const b=$('#book-now');b.disabled=true;message($('#formMessage'),'正在核对旧订单，核对完成后立即订场…');try{const v={identity:identity(),allowSwitch:$('#allow-switch').checked,includePremium:$('#include-premium').checked,venue:$('#venue').value,date:$('#date').value,start:$('#start').value,end:$('#end').value,mode:'now',repeatDaily:false};await api('/api/jobs',{method:'POST',body:JSON.stringify(v)});message($('#formMessage'),'已提交立即订场任务，请在下方查看锁场和支付发送进度。');await load();}catch(e){message($('#formMessage'),e.message,true)}finally{b.disabled=false}};
$('#check').onclick=async()=>{try{message($('#formMessage'),'正在读取实时场次…');const d=await api('/api/check',{method:'POST',body:JSON.stringify(payload())});message($('#formMessage'),d.targetAvailable?`目标时间有连续空位：${d.targetCourt}。共读取到 ${d.available.length} 个可选时段。`:`目标时间暂无符合场地偏好的完整连续空位；其他可选时段共 ${d.available.length} 个。`) }catch(e){message($('#formMessage'),e.message,true)}};
$('#schedule').onclick=async()=>{try{const j=await api('/api/jobs',{method:'POST',body:JSON.stringify(payload())});message($('#formMessage'),`任务已启用，将在 ${new Date(j.runAt).toLocaleString()} 执行。`);load()}catch(e){message($('#formMessage'),e.message,true)}};
$('#import').onclick=async()=>{try{const file=$('#har').files[0];if(!file)throw Error('请先选择HAR文件');message($('#harMessage'),'正在本机解析…');const har=JSON.parse(await file.text());const r=await api('/api/import-har',{method:'POST',body:JSON.stringify({identity:identity(),allowSwitch:$('#allow-switch').checked,includePremium:$('#include-premium').checked,venue:$('#venue').value,har})});message($('#harMessage'),r.message);load()}catch(e){message($('#harMessage'),e.message,true)}};
$('#date').onchange=()=>{const d=new Date($('#date').value+'T00:00:00');d.setDate(d.getDate()-1);d.setHours($('#venue').value==='dashahe'?11:22,0,0,0);$('#runAt').value=localValue(d)};
const events=new EventSource('/api/events');
events.onmessage=e=>{try{renderJobs(JSON.parse(e.data))}catch{load()}};
$('#venue').onchange=()=>{$('#venue-rule').textContent=$('#venue').value==='dashahe'?'大沙河：11:00放号，付费预约1–4小时；实际可订日期以平台为准。':'大学城：22:00放号，付费预约1–2小时。';$('#date').onchange();};
load();setInterval(load,30000);
async function syncState(){try{const s=await api('/api/session-sync/status');const d=s.diagnostics;message($('#sync-message'),s.message+(s.active?'（接收窗口已开启）':'')+(d?' '+d.hint:''),!!d&&(!d.listening||!d.proxy.matches));}catch(e){message($('#sync-message'),e.message,true)}}
$('#sync-start').onclick=async()=>{try{const s=await api('/api/session-sync/start',{method:'POST',body:JSON.stringify({identity:identity()})});message($('#sync-message'),s.message);}catch(e){message($('#sync-message'),e.message,true)}};
$('#sync-stop').onclick=async()=>{try{await api('/api/session-sync/stop',{method:'POST',body:'{}'});await syncState();}catch(e){message($('#sync-message'),e.message,true)}};
syncState();setInterval(syncState,3000);

$('#select-all-jobs').onchange=()=>{if($('#select-all-jobs').checked)deletableJobs.forEach(id=>selectedJobs.add(id));else selectedJobs.clear();load()};
$('#delete-jobs').onclick=async()=>{
 const ids=[...selectedJobs];if(!ids.length)return;
 $('#delete-jobs').disabled=true;
 try{
   const r=await api('/api/jobs/delete',{method:'POST',body:JSON.stringify({ids})});
   ids.forEach(id=>selectedJobs.delete(id));message($('#delete-message'),r.message);await load();
 }catch(e){message($('#delete-message'),e.message,true);}
 finally{updateDeletionControls();}
};
