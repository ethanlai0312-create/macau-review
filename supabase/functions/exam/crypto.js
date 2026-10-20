const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const unhex = s => Uint8Array.from(s.match(/.{2}/g) || [], b => parseInt(b,16));
export async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(s))); }
export function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function hashPassword(password, salt = randomToken()) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return `pbkdf2$600000$${salt}$${hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:unhex(salt)},key,256))}`;
}
export async function verifyPassword(password, stored) {
  if (!/^pbkdf2\$600000\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(stored || '')) return false;
  const actual = await hashPassword(password, stored.split('$')[2]);
  let difference = 0;
  for(let i=0;i<actual.length;i++) difference |= actual.charCodeAt(i) ^ stored.charCodeAt(i);
  return difference === 0;
}
