import {createHandler} from './handler.js';
const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const origins = (Deno.env.get('ALLOWED_ORIGINS') || 'https://ethanlai0312-create.github.io').split(',').filter(Boolean);
// Built-in service key stays exclusively in the Edge runtime. A separate override is optional.
const ipSecret = Deno.env.get('IP_HASH_SECRET') || key;
if (!ipSecret || !origins.length) throw new Error('Required configuration missing');
Deno.serve(createHandler({
  allowedOrigins:origins, ipSecret,
  getIP:(req:Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
  rpc:async (action:string,token:string,payload:unknown) => {
    const endpoint = ['practice','practice-check'].includes(action) ? 'practice_api' : 'exam_api';
    const response = await fetch(`${url}/rest/v1/rpc/${endpoint}`,{
      method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_action:action,p_token:token,p_payload:payload})
    });
    if (!response.ok) throw new Error('Database request failed');
    return response.json();
  }
}));
