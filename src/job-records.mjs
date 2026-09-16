export const visibleJobs=jobs=>jobs.filter(j=>!j.deletedAt);
export function deleteJobRecords(jobs,ids,now=new Date().toISOString()){
  if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'))throw Error('请选择1至500条记录');
  const selected=[...new Set(ids)].map(id=>jobs.find(j=>j.id===id));
  if(selected.some(j=>!j))throw Error('部分记录不存在，请刷新后重试');
  if(selected.some(j=>['scheduled','running'].includes(j.status)))throw Error('等待中的任务请先取消；执行中的任务不能删除');
  // Preserve the order evidence used by reconciliation and duplicate prevention.
  for(const job of selected)job.deletedAt??=now;
  return selected.length;
}
