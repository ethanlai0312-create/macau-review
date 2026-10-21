import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {hashPassword,verifyPassword,sha256} from '../supabase/functions/exam/crypto.js';
import {createHandler} from '../supabase/functions/exam/handler.js';
import {formatTime} from '../src/time.js';
const db=new PGlite();
await db.exec('create role anon;create role authenticated;create role service_role;');
await db.exec(readFileSync('supabase/migrations/202610200001_exam.sql','utf8'));
await db.exec(readFileSync('supabase/practice.sql','utf8'));
const synthetic=Array.from({length:100},(_,i)=>({id:String(i+1).padStart(3,'0'),points:1,type:'single',cn:{prompt:`Test ${i}`,options:['A','B'],explanation:'A is correct'},tw:{prompt:`Test ${i}`,options:['A','B'],explanation:'A is correct'},answer:'0'}));
const bank=existsSync('private/bank.json')?JSON.parse(readFileSync('private/bank.json','utf8')):synthetic;
await db.query('insert into exam_private.banks values ($1,$2,true)',['test',JSON.stringify(bank)]);
const password='0007-Test-only',hash=await hashPassword(password);
for(let i=1;i<=10;i++) await db.query('insert into exam_private.accounts(id,password_hash) values($1,$2)',[String(i).padStart(3,'0'),hash]);
const rpc=async(action,token='',payload={})=>(await db.query(`select public.${['practice','practice-check'].includes(action)?'practice_api':'exam_api'}($1,$2,$3) as result`,[action,token,JSON.stringify(payload)])).rows[0].result;
const handler=createHandler({rpc,allowedOrigins:['https://example.test'],ipSecret:'test-secret',getIP:()=> 'test'});
async function request(action,payload={},token='') {
 const response=await handler(new Request('https://api.test',{method:'POST',headers:{origin:'https://example.test',authorization:`Bearer ${token}`},body:JSON.stringify({action,payload})}));
 return {status:response.status,data:await response.json()};
}
const correctAnswers=Object.fromEntries(bank.map(q=>[q.id,q.type==='text'?q.answer[0]:q.answer]));
after(()=>db.close());
test('100 unique questions, one point each, bilingual prompt/options/explanation',()=>{
 assert.equal(bank.length,100);assert.equal(new Set(bank.map(q=>q.id)).size,100);
 for(const q of bank){assert.equal(q.points,1);assert(q.cn.prompt&&q.tw.prompt&&q.cn.explanation&&q.tw.explanation);assert.equal(q.cn.options.length,q.tw.options.length);}
});
test('time formatting supports 1 second, minutes, hours, >24h and floor',()=>{
 assert.equal(formatTime(1000),'00:00:01');assert.equal(formatTime(327000),'00:05:27');
 assert.equal(formatTime(4363000),'01:12:43');assert.equal(formatTime(90061000),'25:01:01');assert.equal(formatTime(1999),'00:00:01');
});
test('salted password hashes preserve zeroes and reject mismatches',async()=>{
 assert(await verifyPassword(password,hash));assert(!(await verifyPassword('007-Test-only',hash)));
 assert(!(await verifyPassword('wrong',hash)));assert.notEqual(hash,await hashPassword(password));
});
test('invalid authentication and unauthenticated APIs fail',async()=>{
 for(const account of ['000','011','999','1','001']) {
  const r=await request('login',{account,password:'wrong'});assert.equal(r.status,401);
 }
 for(const action of ['state','submit','review','leaderboard','save']) assert.equal((await request(action)).status,401);
 const r=await handler(new Request('https://api.test',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}));assert.equal(r.status,403);
});
test('rate limiting persists across failed logins',async()=>{
 let final;
 for(let i=0;i<11;i++) final=await rpc('prelogin','',{account:'099',ip:'separate'});
 assert.equal(final.error,'RATE_LIMIT');
});
test('server state conceals all answers and explanations before submission',async()=>{
 const r=await request('login',{account:'001',password});assert.equal(r.status,200);
 const data=r.data;assert.equal(data.account,'001');assert.equal(data.questions.length,100);
 for(const q of data.questions){assert(!('answer'in q));assert(!q.cn.explanation);assert(!q.tw.explanation);}
 const token=await sha256(data.token);
 assert.equal((await rpc('review',token,{id:data.attempt.id})).error,'NOT_SUBMITTED');
 const resumed=await rpc('login','',{account:'001',token_hash:'resume-token'});
 assert.equal(resumed.attempt.id,data.attempt.id);assert.equal(resumed.attempt.started_at,data.attempt.started_at);
 assert.equal((await rpc('leaderboard',token)).rows.length,0);
});
test('draft persistence, optimistic conflicts, full score, immutable/idempotent submission',async()=>{
 const login=await rpc('login','',{account:'002',token_hash:'t2'});
 const id=login.attempt.id;
 const saved=await rpc('save','t2',{id,revision:0,answers:{'001':correctAnswers['001']}});
 assert.equal(saved.attempt.revision,1);
 const state=await rpc('state','t2');assert.deepEqual(state.attempt.answers,{'001':correctAnswers['001']});
 assert.equal((await rpc('save','t2',{id,revision:0,answers:{}})).error,'CONFLICT');
 await db.query("update exam_private.attempts set started_at=clock_timestamp()-interval '25 hours 1 minute 1 second' where id=$1",[id]);
 const submitted=await rpc('submit','t2',{id,revision:1,answers:correctAnswers,score:999,elapsed_seconds:0});
 assert.equal(submitted.attempt.score,100);assert(submitted.attempt.elapsed_seconds>=90061);assert.equal(submitted.attempt.unanswered,0);
 const retry=await rpc('submit','t2',{id,revision:0,answers:{},score:0});
 assert.deepEqual(retry.attempt,submitted.attempt);
 const updated=await rpc('save','t2',{id,revision:2,answers:{}});assert.equal(updated.attempt.score,100);
 const review=await rpc('review','t2',{id});assert.equal(review.questions.length,100);assert(review.questions[0].cn.explanation);
});
test('empty and wrong submissions score zero; partial score is integer and exact',async()=>{
 for(const [account,token,answers,expected,unanswered] of [
  ['003','t3',{},0,100],
  ['004','t4',Object.fromEntries(bank.map(q=>[q.id,'__wrong__'])),0,0],
  ['005','t5',Object.fromEntries(Object.entries(correctAnswers).slice(0,37)),37,63]
 ]) {
  const r=await rpc('login','',{account,token_hash:token});
  const score=await rpc('submit',token,{id:r.attempt.id,revision:0,answers,score:100,elapsed_seconds:-10});
  assert.equal(score.attempt.score,expected);assert.equal(score.attempt.unanswered,unanswered);
 }
});
test('multi exact sets, text normalization, numeric validation, matching and order grading',async()=>{
 const checks=[
 [{type:'multi',answer:['0','2']},['2','0'],true],
 [{type:'multi',answer:['0','2']},['0'],false],
 [{type:'multi',answer:['0','2']},['0','2','2'],false],
 [{type:'text',answer:['澳门','澳門']},' 澳 門 ',true],
 [{type:'number',answer:'180',tolerance:0},'１８０',true],
 [{type:'number',answer:'180',tolerance:0},'180abc',false],
 [{type:'number',answer:'180',tolerance:0},'Infinity',false],
 [{type:'match',answer:{0:'1',1:'0'}},{0:'1',1:'0'},true],
 [{type:'match',answer:{0:'1',1:'0'}},{0:'1'},false],
 [{type:'order',answer:['2','0','1']},['2','0','1'],true],
 [{type:'order',answer:['2','0','1']},['0','2','1'],false]
 ];
 for(const [q,a,expected] of checks){
  const r=await db.query('select exam_private.correct($1,$2) as correct',[JSON.stringify(q),JSON.stringify(a)]);
  assert.equal(r.rows[0].correct,expected,JSON.stringify([q,a]));
 }
});
test('cross account access denied; previous best preserved; score/time stable sorting',async()=>{
 const r=await rpc('state','resume-token');
 const deny=await rpc('save','t2',{id:r.attempt.id,revision:0,answers:{}});assert.equal(deny.error,'NOT_FOUND');
 const again=await rpc('start','t2');
 await rpc('submit','t2',{id:again.attempt.id,revision:0,answers:{}});
 const b=(await rpc('leaderboard','t2')).rows;
 assert.equal(new Set(b.map(r=>r.account)).size,b.length);
 assert.equal(b.find(r=>r.account==='002').score,100);
 assert.equal(b[0].account,'002');assert.equal(b[1].account,'005');
 assert(!b.some(r=>r.account==='001'));
 const history=(await rpc('history','t2')).rows;assert.equal(history.length,2);
});
test('anonymous and authenticated SQL roles cannot call API or read private tables',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query("select public.exam_api('state','','{}')"));
  await assert.rejects(db.query('select * from exam_private.accounts'));
  await assert.rejects(db.query('select * from exam_private.banks'));
  await db.exec('reset role');
 }
});
test('logout revokes server session',async()=>{
 await rpc('logout','t5');assert.equal((await rpc('state','t5')).error,'AUTH');
});
test('all single-choice options have exactly one accepted answer; every declared text alias works',async()=>{
 for(const q of bank){
  if(q.type==='single'||q.type==='boolean'){
   let accepted=0;
   for(let i=0;i<q.cn.options.length;i++){
    const r=await db.query('select exam_private.correct($1,$2) as correct',[JSON.stringify(q),JSON.stringify(String(i))]);
    if(r.rows[0].correct)accepted++;
   }
   assert.equal(accepted,1,q.id);
  }
  if(q.type==='text'){
   for(const alias of q.answer){
    const r=await db.query('select exam_private.correct($1,$2) as correct',[JSON.stringify(q),JSON.stringify('  '+alias+'  ')]);
    assert(r.rows[0].correct,q.id);
   }
  }
 }
});
test('exact score/time/submission-time ties have stable account ordering',async()=>{
 const ids=[];
 for(const account of ['006','007']){
  const r=await rpc('login','',{account,token_hash:'tie'+account});
  ids.push(r.attempt.id);
  await rpc('submit','tie'+account,{id:r.attempt.id,revision:0,answers:correctAnswers});
 }
 await db.query("update exam_private.attempts set elapsed_seconds=60,submitted_at='2026-10-20T00:00:00Z' where id=any($1::uuid[])",[ids]);
 const tied=(await rpc('leaderboard','tie006')).rows.filter(r=>['006','007'].includes(r.account));
 assert.deepEqual(tied.map(r=>r.account),['006','007']);
});

test('public practice grades each question without login or ranked writes',async()=>{
 const before=(await db.query('select count(*) as n from exam_private.attempts')).rows[0].n;
 const start=await request('practice');assert.equal(start.status,200);assert.equal(start.data.questions.length,100);
 for(const q of start.data.questions){assert(!q.answer);assert(!q.cn.explanation);assert(!q.tw.explanation);}
 for(const q of bank){
  const checked=await request('practice-check',{bank:'test',id:q.id,answer:correctAnswers[q.id]});
  assert.equal(checked.status,200);assert.equal(checked.data.correct,true,q.id);assert.deepEqual(checked.data.question.answer,q.answer);
 }
 const wrong=await request('practice-check',{bank:'test',id:bank[0].id,answer:null});assert.equal(wrong.data.correct,false);assert(wrong.data.question.cn.explanation);
 assert.equal((await db.query('select count(*) as n from exam_private.attempts')).rows[0].n,before);
 assert.equal((await request('submit')).status,401);assert.equal((await request('leaderboard')).status,401);
 assert.equal((await request('practice-check',{bank:'missing',id:'001'})).status,400);
});

test('practice direct database access denied and rate limit enforced',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query("select public.practice_api('practice','x','{}')"));
  await db.exec('reset role');
 }
 await db.query("insert into exam_private.rate_limits values ('practice:limited',600,clock_timestamp())");
 assert.equal((await rpc('practice','limited')).error,'RATE_LIMIT');
});
