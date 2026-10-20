create schema if not exists exam_private;
revoke all on schema exam_private from public, anon, authenticated;

create table exam_private.accounts (
  id text primary key check (id ~ '^00[1-9]$|^010$'),
  password_hash text not null check (password_hash like 'pbkdf2$600000$%'),
  enabled boolean not null default true
);
create table exam_private.banks (
  id text primary key, questions jsonb not null,
  active boolean not null default false,
  check (jsonb_typeof(questions)='array' and jsonb_array_length(questions)=100)
);
create unique index one_bank on exam_private.banks(active) where active;
create table exam_private.sessions (
  token_hash text primary key,
  account text not null references exam_private.accounts(id),
  expires_at timestamptz not null default now()+interval '30 days'
);
create table exam_private.rate_limits (
  key text primary key, hits integer not null,
  window_at timestamptz not null
);
create table exam_private.attempts (
  id uuid primary key default gen_random_uuid(),
  account text not null references exam_private.accounts(id),
  bank text not null references exam_private.banks(id),
  started_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  answers jsonb not null default '{}',
  revision integer not null default 0,
  score integer check(score between 0 and 100),
  unanswered integer check(unanswered between 0 and 100),
  elapsed_seconds bigint check(elapsed_seconds>=0),
  grading jsonb,
  check ((submitted_at is null and score is null) or (submitted_at is not null and score is not null))
);
create unique index one_active_attempt on exam_private.attempts(account) where submitted_at is null;
create index attempt_best on exam_private.attempts(account,score desc,elapsed_seconds,submitted_at);
alter table exam_private.accounts enable row level security;
alter table exam_private.banks enable row level security;
alter table exam_private.sessions enable row level security;
alter table exam_private.rate_limits enable row level security;
alter table exam_private.attempts enable row level security;

create function exam_private.normalized(v text) returns text
language sql immutable set search_path='' as $$
 select lower(regexp_replace(normalize(coalesce(v,''),NFKC),'\s','','g'))
$$;
create function exam_private.is_answered(v jsonb) returns boolean
language sql immutable set search_path='' as $$
 select v is not null and v not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb)
 and (jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}'))>0)
$$;
create function exam_private.correct(q jsonb, a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare result boolean;
begin
 if not exam_private.is_answered(a) then return false; end if;
 case q->>'type'
 when 'multi' then
   if jsonb_typeof(a)<>'array' then return false; end if;
   select jsonb_agg(x order by x) = (select jsonb_agg(y order by y) from jsonb_array_elements(q->'answer') y)
   into result from jsonb_array_elements(a) x;
   return coalesce(result,false);
 when 'text' then
   if jsonb_typeof(a)<>'string' then return false; end if;
   return exists(select 1 from jsonb_array_elements_text(q->'answer') x
     where exam_private.normalized(x)=exam_private.normalized(a#>>'{}'));
 when 'number' then
   if jsonb_typeof(a) not in ('string','number') then return false; end if;
   if exam_private.normalized(a#>>'{}') !~ '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then return false; end if;
   return abs(exam_private.normalized(a#>>'{}')::numeric - (q->>'answer')::numeric)
          <= coalesce((q->>'tolerance')::numeric,0);
 else return a = q->'answer';
 end case;
exception when others then return false;
end $$;

create function public.exam_api(p_action text,p_token text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 who text; rec exam_private.attempts%rowtype; bank_data jsonb; public_bank jsonb;
 answer_data jsonb; q jsonb; a jsonb; marks jsonb='[]'; score_n integer=0; missing integer=0;
 ok boolean; key_n text; hit_n integer; token_n text; now_n timestamptz=clock_timestamp();
begin
 if p_action='prelogin' then
   -- Both counters are updated even when the account does not exist. No exception rollback on failures.
   foreach key_n in array array['account:'||left(coalesce(p_payload->>'account',''),128),
                               'ip:'||coalesce(p_payload->>'ip','unknown')] loop
     insert into exam_private.rate_limits as r values(key_n,1,now_n)
     on conflict(key) do update set
       hits=case when r.window_at < now_n-interval '15 minutes' then 1 else r.hits+1 end,
       window_at=case when r.window_at < now_n-interval '15 minutes' then now_n else r.window_at end
     returning hits into hit_n;
     if hit_n > (case when key_n like 'account:%' then 10 else 60 end) then
       return jsonb_build_object('error','RATE_LIMIT');
     end if;
   end loop;
   select password_hash into token_n from exam_private.accounts
     where id=p_payload->>'account' and enabled;
   return jsonb_build_object('hash',token_n);
 end if;
 if p_action='login' then
   who=p_payload->>'account';
   if not exists(select 1 from exam_private.accounts where id=who and enabled) then
     return jsonb_build_object('error','AUTH'); end if;
   insert into exam_private.sessions(token_hash,account) values(p_payload->>'token_hash',who);
 else
   select s.account into who from exam_private.sessions s join exam_private.accounts u on u.id=s.account
     where s.token_hash=p_token and s.expires_at>now_n and u.enabled;
   if who is null then return jsonb_build_object('error','AUTH'); end if;
 end if;
 if p_action='logout' then
   delete from exam_private.sessions where token_hash=p_token;
   return jsonb_build_object('ok',true);
 end if;
 -- Account-scoped lock serializes resume/start/save/submit across devices.
 perform pg_advisory_xact_lock(hashtext(who));
 if p_action in ('login','start') then
   if not exists(select 1 from exam_private.attempts where account=who and submitted_at is null) then
     insert into exam_private.attempts(account,bank)
       select who,id from exam_private.banks where active;
   end if;
 end if;
 if p_action in ('login','start','state') then
   select * into rec from exam_private.attempts where account=who and submitted_at is null;
   if rec.id is not null then
     select questions into bank_data from exam_private.banks where id=rec.bank;
     select jsonb_agg((x - 'answer' - 'explanation' - 'source' - 'tolerance') #- '{cn,explanation}' #- '{tw,explanation}') into public_bank
       from jsonb_array_elements(bank_data) x;
   end if;
   return jsonb_build_object('account',who,'attempt',case when rec.id is null then null else to_jsonb(rec)-'grading' end,
     'questions',coalesce(public_bank,'[]'),'serverNow',now_n);
 end if;
 if p_action='leaderboard' then
   return jsonb_build_object('serverNow',now_n,'rows',coalesce((
     select jsonb_agg(to_jsonb(r)) from (
       select row_number() over(order by score desc,elapsed_seconds,submitted_at,account) as rank,
              account,score,elapsed_seconds,submitted_at
       from (select distinct on(account) account,score,elapsed_seconds,submitted_at
             from exam_private.attempts where submitted_at is not null
             order by account,score desc,elapsed_seconds,submitted_at,id) b
       order by score desc,elapsed_seconds,submitted_at,account
     ) r),'[]'));
 end if;
 if p_action='history' then
   return jsonb_build_object('rows',coalesce((
     select jsonb_agg(to_jsonb(t)) from (
       select id,score,unanswered,elapsed_seconds,submitted_at from exam_private.attempts
       where account=who and submitted_at is not null order by submitted_at desc limit 100
     ) t),'[]'));
 end if;
 select * into rec from exam_private.attempts where account=who and id=(p_payload->>'id')::uuid for update;
 if rec.id is null then return jsonb_build_object('error','NOT_FOUND'); end if;
 if p_action='review' then
   if rec.submitted_at is null then return jsonb_build_object('error','NOT_SUBMITTED'); end if;
   select questions into bank_data from exam_private.banks where id=rec.bank;
   return jsonb_build_object('attempt',to_jsonb(rec),'questions',bank_data,'serverNow',now_n);
 end if;
 if p_action in ('save','submit') then
   -- A committed submission is immutable; retry always returns the original result.
   if rec.submitted_at is not null then
     return jsonb_build_object('attempt',to_jsonb(rec),'serverNow',now_n); end if;
   if (p_payload->>'revision')::integer is distinct from rec.revision then
     return jsonb_build_object('error','CONFLICT'); end if;
   answer_data=p_payload->'answers';
   if jsonb_typeof(answer_data) is distinct from 'object' or octet_length(answer_data::text)>50000 then
     return jsonb_build_object('error','INVALID'); end if;
   select questions into bank_data from exam_private.banks where id=rec.bank;
   if exists(select 1 from jsonb_object_keys(answer_data) k
     where not exists(select 1 from jsonb_array_elements(bank_data) b where b->>'id'=k)) then
     return jsonb_build_object('error','INVALID'); end if;
   if p_action='save' then
     update exam_private.attempts set answers=answer_data,revision=revision+1 where id=rec.id returning * into rec;
     return jsonb_build_object('attempt',to_jsonb(rec)-'grading','serverNow',now_n);
   end if;
   for q in select * from jsonb_array_elements(bank_data) loop
     a=answer_data->(q->>'id');
     if not exam_private.is_answered(a) then missing=missing+1; end if;
     ok=exam_private.correct(q,a);
     if ok then score_n=score_n+1; end if;
     marks=marks||jsonb_build_array(jsonb_build_object('id',q->>'id','correct',ok,
       'answered',exam_private.is_answered(a)));
   end loop;
   update exam_private.attempts set answers=answer_data,revision=revision+1,submitted_at=now_n,
     score=score_n,unanswered=missing,grading=marks,
     elapsed_seconds=greatest(0,floor(extract(epoch from(now_n-started_at)))::bigint)
     where id=rec.id returning * into rec;
   return jsonb_build_object('attempt',to_jsonb(rec),'serverNow',now_n);
 end if;
 return jsonb_build_object('error','INVALID');
end $$;
revoke all on function public.exam_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.exam_api(text,text,jsonb) to service_role;
revoke all on all functions in schema exam_private from public,anon,authenticated;
revoke all on all tables in schema exam_private from public,anon,authenticated;
