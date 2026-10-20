-- Run only in the administrator's Supabase SQL editor.
-- Submitted history (never includes passwords or session tokens).
select account,id,score,100-score-unanswered as wrong,unanswered,
       elapsed_seconds,started_at,submitted_at
from exam_private.attempts
where submitted_at is not null
order by submitted_at desc;

-- Shared ranking, same ordering as application.
select row_number() over(order by score desc,elapsed_seconds,submitted_at,account) rank,
       account,score,elapsed_seconds,submitted_at
from (
  select distinct on(account) account,score,elapsed_seconds,submitted_at
  from exam_private.attempts where submitted_at is not null
  order by account,score desc,elapsed_seconds,submitted_at,id
) best
order by score desc,elapsed_seconds,submitted_at,account;

-- Active question bank size.
select id,jsonb_array_length(questions) as question_count,active from exam_private.banks;
