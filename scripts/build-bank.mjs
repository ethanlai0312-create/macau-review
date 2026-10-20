import {readFileSync,writeFileSync} from 'node:fs';
const questions=JSON.parse(readFileSync('private/bank.json','utf8'));
if(questions.length!==100 || new Set(questions.map(q=>q.id)).size!==100) throw Error('Bank must have exactly 100 unique questions');
for(const q of questions) {
  if(q.points!==1 || !q.cn?.explanation || !q.tw?.prompt || q.answer==null) throw Error(`Invalid question ${q.id}`);
}
const json=JSON.stringify(questions).replaceAll("'","''");
writeFileSync('supabase/seed.sql',`-- PRIVATE answer key. Apply only to the database; never upload to GitHub.\nbegin;\nupdate exam_private.banks set active=false where active;\ninsert into exam_private.banks(id,questions,active) values('macau-2026-v1','${json}'::jsonb,true);\ncommit;\n`);
console.log('Private database seed prepared; intentionally excluded from Git.');
