export const venues = [
  {id:'campus',name:'深圳大学城体育中心',releaseAt:'22:00',maxMinutes:120},
  {id:'dashahe',name:'大沙河国际网球交流中心',releaseAt:'11:00',maxMinutes:240,
    venueId:'7e8d7188-31a9-4408-875d-b4618a764982',sportId:'1f2c23a3-3720-44c8-b78b-971d8860fbac',
    extype:10,payeeconfigid:'d5fgra566n4bgpgn00j0'}
];
export function getVenue(id='campus') {
  const venue=venues.find(v=>v.id===id);if(!venue)throw Error('不支持的场馆');return venue;
}
export function venueProfile(profile,id='campus') {
  const v=getVenue(id);
  if(id!=='campus'&&profile.identity!=='市民')throw Error('该场馆仅接入市民付费预约');
  return {...profile,venueName:v.name,releaseAt:v.releaseAt,
    ...(id==='campus'?{}:{extype:v.extype,payeeconfigid:v.payeeconfigid}),
    target:{...profile.target,...(id==='campus'?{}:{venueId:v.venueId,sportId:v.sportId})}};
}
export const jobVenue=j=>j.venue??'campus';
