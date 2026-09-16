export async function bindCitizen(template,session,client){
  const user=await client.request('wtt/user/wttauth/info',{appid:session.appid,timestamp:Math.floor(Date.now()/1000)},'POST');
  if(!user.uid||!user.idcardhash||user.idcardauthstatus!==200)throw Error('请先在官方小程序完成本人实名认证');
  const players=await client.request('wtt/user/playerstore/list',{page:1,pagesize:999},'POST');
  const self=players.list?.filter(p=>p.status===200&&p.idcardhash===user.idcardhash);
  if(!self?.length||typeof self[0].id!=='string'||self[0].id.includes(','))throw Error('请在官方小程序添加本人为常用参与人后重试');
  return {...template,target:{...template.target,accountId:user.uid},selfHash:user.idcardhash,playerIds:[self[0].id]};
}
