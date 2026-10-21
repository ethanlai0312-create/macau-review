import { sha256, randomToken, verifyPassword, hashPassword } from './crypto.js';
export function createHandler({rpc, allowedOrigins, ipSecret, getIP}) {
  let dummyHash;
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
    if (origin && allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    const respond = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
    if (origin && !allowedOrigins.includes(origin)) return respond({error:'ORIGIN'},403);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return respond({error:'METHOD'},405);
    try {
      const text = await request.text();
      if (text.length > 65536) return respond({error:'TOO_LARGE'},413);
      const body = JSON.parse(text);
      if (!body || typeof body !== 'object') return respond({error:'INVALID'},400);
      const {action, payload = {}} = body;
      if (action === 'practice' || action === 'practice-check') {
        const ip = await sha256(ipSecret + ':' + getIP(request));
        const data = await rpc(action,ip,payload);
        return respond(data,data.error === 'RATE_LIMIT' ? 429 : data.error ? 400 : 200);
      }
      if (action === 'login') {
        const {account,password} = payload;
        if (typeof account !== 'string' || typeof password !== 'string' || password.length > 128)
          return respond({error:'LOGIN'},401);
        const ip = await sha256(ipSecret + ':' + getIP(request));
        const pre = await rpc('prelogin','',{account,ip});
        if (pre.error) return respond(pre,pre.error === 'RATE_LIMIT' ? 429 : 401);
        dummyHash ||= hashPassword(randomToken());
        const valid = await verifyPassword(password,pre.hash || await dummyHash);
        if (!valid || !pre.hash) return respond({error:'LOGIN'},401);
        const token = randomToken();
        const state = await rpc('login','',{account,token_hash:await sha256(token)});
        return respond({...state,token});
      }
      if (!['state','save','submit','review','leaderboard','history','start','logout'].includes(action))
        return respond({error:'INVALID'},400);
      const token = request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
      if (!/^[a-f0-9]{64}$/.test(token)) return respond({error:'AUTH'},401);
      const data = await rpc(action,await sha256(token),payload);
      return respond(data,data.error === 'AUTH' ? 401 : data.error === 'CONFLICT' ? 409 : data.error ? 400 : 200);
    } catch (_) {
      return respond({error:'SERVER'},500);
    }
  };
}
