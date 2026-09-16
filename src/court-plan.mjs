export function compactSegments(rows) {
  const result=[];
  for(const row of [...rows].sort((a,b)=>a.start.localeCompare(b.start))) {
    const last=result.at(-1);
    if(last&&last.end===row.start&&last.courtId===row.courtId)last.end=row.end;
    else result.push({courtId:row.courtId,start:row.start,end:row.end});
  }
  return result;
}
export function samePlan(a,b) {
  const segments=x=>compactSegments(x.segments??[{courtId:x.courtId,start:x.start,end:x.end}]);
  return JSON.stringify(segments(a))===JSON.stringify(segments(b));
}
export function filterCourts(slots,profile,includePremium=false) {
  if(profile.target.sportId!=='1f2c23a3-3720-44c8-b78b-971d8860fbac'||includePremium)return slots;
  const excluded=new Set(['4cd18fd4-5833-486e-ae80-e90db1220f77','b10ff116-4e06-4f09-ad6a-c4172cd152da']);
  return slots.filter(s=>!excluded.has(s.courtId));
}
