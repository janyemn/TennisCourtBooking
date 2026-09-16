// One early check per scheduled occurrence; restarting the server checks again.
export function createLoginPreflight({check,openSync,save,now=Date.now}) {
  const attempted=new Set();
  let busy=false;
  return async jobs=>{
    if(busy)return;
    const candidates=jobs.filter(j=>j.status==='scheduled'&&!j.timing?.immediate&&
      Date.parse(j.runAt)-now()<=20*60000&&Date.parse(j.runAt)-now()>15000&&
      !attempted.has(`${j.id}:${j.runAt}`));
    if(!candidates.length)return;
    busy=true;
    try {
      for(const job of candidates){
        attempted.add(`${job.id}:${job.runAt}`);
        let syncMessage;
        try{syncMessage=await openSync(job);}catch(error){syncMessage='自动同步未开启：'+error.message;}
        const health=await check(job.identity);
        if(job.status!=='scheduled')continue;
        let message=health.status==='valid'?'提前登录检查通过；开抢前仍会核验最新会话':
          health.status==='expired'?'登录已失效':`提前登录检查未通过：${health.message}`;
        message+='；'+syncMessage;
        job.loginPreparation={checkedAt:health.checkedAt,status:health.status,message};
        job.message=message;
        await save();
      }
    }finally{busy=false;}
  };
}
