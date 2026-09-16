import test from 'node:test';
import assert from 'node:assert/strict';
import {bindCitizen} from '../src/onboarding.mjs';
const template={target:{venueId:'venue',sportId:'tennis'},identity:'市民'};
const session={appid:'test'};
const client=(user,players)=>({request:async path=>path.endsWith('/info')?user:{list:players}});
test('first binding derives account and participant from verified official responses',async()=>{
 const p=await bindCitizen(template,session,client({uid:'new-user',idcardhash:'self',idcardauthstatus:200},[{id:'other',status:200,idcardhash:'other'},{id:'me',status:200,idcardhash:'self'}]));
 assert.equal(p.target.accountId,'new-user');assert.deepEqual(p.playerIds,['me']);assert.equal(template.target.accountId,undefined);
});
test('unverified identity or missing self participant cannot bind',async()=>{
 await assert.rejects(()=>bindCitizen(template,session,client({uid:'u',idcardhash:'h',idcardauthstatus:100},[])));
 await assert.rejects(()=>bindCitizen(template,session,client({uid:'u',idcardhash:'h',idcardauthstatus:200},[{id:'other',status:200,idcardhash:'other'}])));
});
