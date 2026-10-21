-- Public learning mode, accessible only through the rate-limited Edge handler.
-- Reuses trusted grading without creating accounts, sessions or ranked attempts.
create or replace function public.practice_api(p_action text, p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare bank_id text; bank_data jsonb; q jsonb; safe_data jsonb; hits_n integer;
begin
 if p_action not in ('practice','practice-check') then return jsonb_build_object('error','INVALID'); end if;
 insert into exam_private.rate_limits as r values('practice:'||p_token,1,clock_timestamp())
 on conflict(key) do update set
 hits=case when r.window_at<clock_timestamp()-interval '15 minutes' then 1 else r.hits+1 end,
 window_at=case when r.window_at<clock_timestamp()-interval '15 minutes' then clock_timestamp() else r.window_at end
 returning hits into hits_n;
 if hits_n>600 then return jsonb_build_object('error','RATE_LIMIT'); end if;
 if p_action='practice' then
   select id,questions into bank_id,bank_data from exam_private.banks where active;
   if bank_id is null then return jsonb_build_object('error','NOT_FOUND'); end if;
   select jsonb_agg((x-'answer'-'explanation'-'source'-'tolerance') #- '{cn,explanation}' #- '{tw,explanation}')
     into safe_data from jsonb_array_elements(bank_data) x;
   return jsonb_build_object('bank',bank_id,'questions',safe_data);
 end if;
 select questions into bank_data from exam_private.banks where id=p_payload->>'bank';
 select x into q from jsonb_array_elements(bank_data) x where x->>'id'=p_payload->>'id';
 if q is null then return jsonb_build_object('error','NOT_FOUND'); end if;
 return jsonb_build_object('correct',exam_private.correct(q,p_payload->'answer'),'question',q-'source');
end $$;
revoke all on function public.practice_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.practice_api(text,text,jsonb) to service_role;
