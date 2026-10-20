import translations from './translations.json';
import {formatTime,answered} from './time.js';
import {diagram} from './diagrams.js';
import './style.css';
const convert=value=>translations[value]||value;
const $=s=>document.querySelector(s);
const root=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lang=localStorage.getItem('macau-language')||'zh-CN';
const T=s=>esc(lang==='zh-TW'?convert(s):s);
const content=q=>q[lang==='zh-TW'?'tw':'cn'];
const apiURL=import.meta.env.VITE_API_URL;
let token=sessionStorage.getItem('macau-token')||'',account='',attempt=null,questions=[],answers={},current=0;
let page=token?'restoring':'login',notice='',pending=null,dirty=false,saveBusy=false,submitBusy=false,conflict=false;
let board=[],boardSynced='',boardError=false,result=null,review=[],history=[],onlyWrong=false;
let serverAnchor=0,monoAnchor=0,saveTimer;
const key=()=>`macau-draft:${account}:${attempt?.id}`;
function message(code) { return ({
  LOGIN:'账号或密码不正确，请重新输入。',RATE_LIMIT:'尝试次数过多，请在15分钟后再试。',
  AUTH:'登录已过期，请重新登录。同一账号可恢复未提交记录。',
  SERVER:'服务器暂时无法处理，请稍后重试。',NETWORK:'网络连接失败，答案已保留，请重试。',
  CONFLICT:'另一台设备已更新这次练习。请重新同步后核对答案，再继续作答。',
  NOT_SUBMITTED:'交卷前无法查看答案。',NOT_FOUND:'找不到这次练习。',INVALID:'请求内容不符合要求。',
  CONFIG:'网站后端尚未配置，请联系管理员。',ORIGIN:'网站访问来源未获授权。'
})[code]||'操作未完成，请稍后重试。';}
async function api(action,payload={}) {
  if(!apiURL) throw Object.assign(Error('CONFIG'),{code:'CONFIG'});
  let response;
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),20000);
  try {response=await fetch(apiURL,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify({action,payload}),signal:controller.signal});}
  catch (_) {throw Object.assign(Error('NETWORK'),{code:'NETWORK'});}
  finally {clearTimeout(timeout);}
  const data=await response.json();
  if(!response.ok || data.error) throw Object.assign(Error(data.error||'SERVER'),{code:data.error||'SERVER'});
  if(data.serverNow) {serverAnchor=Date.parse(data.serverNow);monoAnchor=performance.now();}
  return data;
}
function fail(error) {
  notice=message(error.code);
  if(error.code==='AUTH') {token='';sessionStorage.removeItem('macau-token');page='login';}
  if(error.code==='CONFLICT') conflict=true;
  render();
}
function elapsed() {
  if(pending) return pending.elapsed;
  if(result && page==='result') return result.elapsed_seconds*1000;
  return attempt?Math.max(0,serverAnchor+performance.now()-monoAnchor-Date.parse(attempt.started_at)):0;
}
function count() {return questions.filter(q=>answered(answers[q.id])).length;}
function persist() {
  if(!attempt) return;
  try {localStorage.setItem(key(),JSON.stringify({answers,current,revision:attempt.revision,pending,dirty}));}
  catch (_) {notice='浏览器本地存储不可用，请保持联网，确认云端保存成功后再离开。';}
}
function restore(data) {
  account=data.account;attempt=data.attempt;questions=data.questions||[];
  answers=attempt?.answers||{};pending=null;dirty=false;conflict=false;
  let draft;
  try {draft=JSON.parse(localStorage.getItem(key())||'null');}catch(_){}
  if(draft && attempt) {
    current=Math.min(99,draft.current||0);
    if(draft.revision===attempt.revision) {answers=draft.answers;pending=draft.pending;dirty=!!draft.dirty;}
    else if(draft.dirty || draft.pending) {notice='云端存在其他设备的更新，本机草稿已保留。请核对云端答案后继续。';conflict=true;}
  }
  page=attempt?'exam':'history';render();
  if(!attempt) loadHistory();
  if(dirty&&!pending&&!conflict) scheduleSave();
}
function scheduleSave() {clearTimeout(saveTimer);saveTimer=setTimeout(save,600);}
async function save() {
  if(saveBusy||!dirty||pending||conflict||!attempt||!token) return;
  saveBusy=true;
  const snapshot=JSON.parse(JSON.stringify(answers));
  try {
    const data=await api('save',{id:attempt.id,revision:attempt.revision,answers:snapshot});
    if(data.attempt.submitted_at) {await showResult(data.attempt);return;}
    attempt=data.attempt;
    dirty=JSON.stringify(answers)!==JSON.stringify(snapshot);persist();notice='';
  } catch(error) {notice=message(error.code);if(error.code==='CONFLICT') conflict=true;if(error.code==='AUTH') fail(error);}
  finally {saveBusy=false;updateProgress();if(dirty&&!pending&&!conflict) {clearTimeout(saveTimer);saveTimer=setTimeout(save,10000);}}
}
function updateProgress() {
  if($('#completion')) $('#completion').textContent=`${count()} / 100`;
  if($('#remaining')) $('#remaining').textContent=String(100-count());
  if($('#progress')) $('#progress').value=count();
  if($('#save-state')) $('#save-state').textContent=lang==='zh-TW'?convert(notice|| (dirty?'正在保存…':'已保存至云端')):(notice||(dirty?'正在保存…':'已保存至云端'));
  document.querySelectorAll('[data-jump]').forEach(b=>b.classList.toggle('answered',answered(answers[questions[Number(b.dataset.jump)]?.id])));
}
function changeAnswer(value) {if(pending||conflict||submitBusy)return;answers[questions[current].id]=value;dirty=true;persist();updateProgress();scheduleSave();}
function header() {
  return `<header><a href="#" class="brand" data-action="home"><span class="brand-icon">澳</span><span>${T('知澳')}<small>MACAU STUDY ROOM</small></span></a>
  <nav><button class="language" data-action="language" aria-label="${T('切换简体与繁体')}">${lang==='zh-CN'?'繁體':'简体'}</button>
  ${account&&token?`<span class="account">${T('账号')} ${esc(account)}</span><button class="quiet" data-action="logout">${T('退出')}</button>`:''}</nav></header>`;
}
function login() {
  return `<main class="login-layout"><section class="intro"><div class="eyebrow">MACAU · LEARN & DISCOVER</div><h1>${T('读懂澳门，')}<br>${T('从每一道题开始。')}</h1><p>${T('城市的脉络、产业的转变、出行的连接与自然的共生。用一次专注的练习，把知识连成自己的地图。')}</p>
  <div class="topics"><span>01 ${T('城市')}</span><span>02 ${T('经济')}</span><span>03 ${T('交通')}</span><span>04 ${T('环境')}</span></div>
  <div class="intro-bottom"><b>100</b><span>${T('道精选复习题')}<br>${T('每题 1 分 · 不限时')}</span></div></section>
  <section class="login-card"><div class="eyebrow">${T('开始你的复习')}</div><h2>${T('欢迎回来')}</h2><p class="muted">${T('使用指定账号登录，进度会自动保存。')}</p>
  <form id="login-form"><label for="account">${T('账号')}</label><input id="account" name="account" inputmode="numeric" autocomplete="username" pattern="00[1-9]|010" maxlength="3" placeholder="001 – 010" required>
  <label for="password">${T('密码')}</label><div class="password"><input id="password" name="password" type="password" autocomplete="current-password" maxlength="128" required><button type="button" data-action="password" aria-label="${T('显示密码')}">${T('显示')}</button></div>
  <p class="feedback" role="alert">${T(notice)}</p><button type="submit" class="primary full">${T('登录并开始')} <span>→</span></button></form>
  <div class="login-note">${T('登录后开始计时。关闭页面后，可重新登录恢复未提交的练习。')}</div></section></main>`;
}
const typeNames={single:'单项选择',multi:'多项选择',boolean:'判断',text:'填空',number:'数值计算',match:'配对',order:'排序'};
function inputs(q) {
  const c=content(q),value=answers[q.id],disabled=pending||conflict?'disabled':'';
  if(['single','boolean','multi'].includes(q.type)) return `<div class="choices">${c.options.map((o,i)=>`<label class="choice ${q.type==='multi'?(value||[]).includes(String(i))?'selected':'':value===String(i)?'selected':''}">
    <input ${disabled} type="${q.type==='multi'?'checkbox':'radio'}" name="option" value="${i}" ${q.type==='multi'?(value||[]).includes(String(i))?'checked':'':value===String(i)?'checked':''}>
    <span class="choice-letter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></label>`).join('')}</div>`;
  if(q.type==='text'||q.type==='number') return `<label class="answer-label" for="answer">${T(q.type==='number'?'输入数值（按题目要求，不附加单位）':'输入答案（简体、繁体均可）')}</label><input ${disabled} id="answer" maxlength="200" autocomplete="off" inputmode="${q.type==='number'?'decimal':'text'}" value="${esc(value||'')}" placeholder="${T('在此作答')}">`;
  if(q.type==='match') return `<div class="matching">${q.left[lang==='zh-TW'?'tw':'cn'].map((left,i)=>`<label>${esc(left)}<select ${disabled} data-match="${i}" aria-label="${esc(left)}"><option value="">${T('请选择')}</option>${c.options.map((o,j)=>`<option value="${j}" ${value?.[i]===String(j)?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`).join('')}</div>`;
  const selected=value||[];
  return `<p class="muted">${T('依次点击项目组成顺序。点击已选项目可撤回，再重新选择。')}</p><ol class="order-selected">${selected.map((v,i)=>`<li><button ${disabled} data-remove="${i}"><b>${i+1}</b>${esc(c.options[Number(v)])}<span>×</span></button></li>`).join('')}</ol><div class="order-pool">${c.options.map((o,i)=>selected.includes(String(i))?'':`<button ${disabled} data-order="${i}">＋ ${esc(o)}</button>`).join('')}</div>`;
}
function exam() {
  const q=questions[current];
  if(!q) return `<main class="panel"><h2>${T('题库暂时不可用')}</h2><button data-action="reload">${T('重新加载')}</button></main>`;
  return `<main class="workspace"><section class="exam-overview"><div><div class="eyebrow">${T('我的练习')}</div><h1>${T('澳门综合复习')}</h1></div><div class="timer-block"><span>${T(pending?'已冻结 · 等待上传':'本次用时')}</span><strong id="timer">${formatTime(elapsed())}</strong></div><div class="progress-block"><span>${T('已答')} <b id="completion">${count()} / 100</b></span><progress id="progress" max="100" value="${count()}"></progress><span>${T('未答')} <b id="remaining">${100-count()}</b></span></div></section>
  ${pending?`<div class="banner">${T('交卷答案已锁定并保存在本机。上传成功后才会计入排行榜。')}<button data-action="retry" ${submitBusy?'disabled':''}>${T(submitBusy?'正在上传…':'重试上传')}</button></div>`:''}
  ${conflict?`<div class="banner">${T('检测到其他设备的更新。请选择保留哪一份答案，另一份草稿会作为本机备份保留。')}<button data-action="resolve">${T('使用云端记录')}</button><button data-action="keep-local">${T('保留本机答案')}</button></div>`:''}
  <div class="exam-grid"><section class="question-card"><div class="question-meta"><span>${T(q.topic)}</span><span>${T(typeNames[q.type])} · ${T('1 分')}</span><span>${T(q.difficulty)}</span></div><div class="question-number">${String(current+1).padStart(2,'0')} <span>/ 100</span></div>
  <h2>${esc(content(q).prompt)}</h2>${q.type==='multi'?`<p class="rule">${T('全部选对才得分，漏选或错选均不得分。')}</p>`:''}${q.diagram?diagram(q.diagram,T):''}
  <fieldset ${pending||conflict?'disabled':''}><legend class="sr-only">${T('作答区域')}</legend>${inputs(q)}</fieldset>
  <div class="question-controls"><button data-action="previous" ${current===0?'disabled':''}>← ${T('上一题')}</button><button class="quiet" data-action="clear" ${pending||conflict?'disabled':''}>${T('清除答案')}</button><button data-action="next" ${current===99?'disabled':''}>${T('下一题')} →</button></div>
  <p id="save-state" class="save-state" role="status">${T(notice||(dirty?'正在保存…':'已保存至云端'))}</p></section>
  <aside class="navigator"><div class="aside-heading"><h2>${T('题目导航')}</h2><span>${T('可跳题')}</span></div><div class="number-grid">${questions.map((v,i)=>`<button data-jump="${i}" class="${i===current?'current ':''}${answered(answers[v.id])?'answered':''}" ${i===current?'aria-current="step"':''} aria-label="${T('第')} ${i+1} ${T('题')}">${i+1}</button>`).join('')}</div>
  <p class="muted">${T('填色表示已答，描边表示当前题目。')}</p><button class="primary full" data-action="confirm" ${pending||conflict?'disabled':''}>${T('交卷并上传')} ↑</button><button class="full quiet" data-action="board">${T('查看排行榜')}</button><button class="full quiet" data-action="history">${T('历史练习')}</button></aside></div></main>`;
}
function leaderboard() {
 return `<section class="leaderboard panel"><div class="section-heading"><div><div class="eyebrow">SHARED LEADERBOARD</div><h2>${T('一起向前')}</h2></div><button data-action="refresh-board">${T('刷新')}</button></div><p class="muted">${T('每个账号只保留历史最佳成绩；同分按用时排序。')}</p>
 <div class="table-head"><span>${T('排名')}</span><span>${T('账号')}</span><span>${T('分数')}</span><span>${T('答题用时')}</span></div>
 <div class="board-rows">${board.map(row=>`<div class="board-row ${row.score===100?'perfect':''} ${row.account===account?'self':''}"><span class="rank">${row.rank}</span><span>${esc(row.account)}${row.account===account?`<small>${T('我')}</small>`:''}</span><strong>${row.score}<small> / 100</small></strong><time>${formatTime(row.elapsed_seconds*1000)}</time></div>`).join('')||`<div class="empty">${T(boardSynced?'还没有已提交的成绩。完成练习后，成为第一位上榜者。':'正在获取共享排行榜…')}</div>`}</div>
 <p class="sync ${boardError?'error':''}" role="status">${T(boardError?'同步失败，当前仅保留上次成功取得的数据。':'每60秒自动同步')}${boardSynced?` · ${T('最近成功同步')} ${new Date(boardSynced).toLocaleTimeString(lang,{hour12:false})}`:''}</p></section>`;
}
async function loadBoard() {
 try {const data=await api('leaderboard');board=data.rows;boardSynced=data.serverNow;boardError=false;}
 catch(error) {boardError=true;if(error.code==='AUTH') {fail(error);return;}}
 if(['board','result'].includes(page)) {
   const existing=$('.leaderboard');
   if(existing) existing.outerHTML=leaderboard();else render();
 }
}
async function showResult(rec) {
 result=rec;pending=null;dirty=false;localStorage.removeItem(key());attempt=null;page='result';notice='';render();await loadBoard();
}
function resultPage() {
 return `<main class="results"><section class="result-summary panel"><div class="eyebrow">${T('交卷成功 · 成绩已存入云端')}</div><div class="score">${result.score}<span>/ 100</span></div><h1>${T(result.score===100?'每一份专注，都有回响。':'把这一次，变成下一次的进步。')}</h1>
 <div class="result-stats"><div><strong>${result.score}</strong><span>${T('正确')}</span></div><div><strong>${100-result.score-result.unanswered}</strong><span>${T('错误')}</span></div><div><strong>${result.unanswered}</strong><span>${T('未答')}</span></div><div><strong>${formatTime(result.elapsed_seconds*1000)}</strong><span>${T('总用时')}</span></div></div>
 <p class="muted">${T('个人最佳名次')}：${board.find(r=>r.account===account)?.rank||'—'} · ${T('最终用时以服务器首次接收交卷时间为准。')}</p>
 <div class="actions"><button class="primary" data-action="review">${T('查看错题与解析')}</button><button data-action="start">${T('再练一次')}</button><button class="quiet" data-action="history">${T('历史练习')}</button></div></section>${leaderboard()}</main>`;
}
function readableAnswer(q,value) {
 if(value==null||!answered(value)) return T('未作答');
 const c=content(q);
 if(q.type==='text') return esc(Array.isArray(value)?value[0]:value);
 if(q.type==='number') return esc(value);
 if(q.type==='match') return Object.entries(value).map(([i,v])=>`${esc(q.left[lang==='zh-TW'?'tw':'cn'][Number(i)])} → ${esc(c.options[Number(v)]||'—')}`).join('；');
 return (Array.isArray(value)?value:[value]).map(v=>esc(c.options[Number(v)]||'—')).join(q.type==='order'?' → ':'；');
}
function reviewPage() {
 return `<main class="results"><section class="panel"><div class="section-heading"><h1>${T('复盘这次练习')}</h1><button data-action="result">${T('返回成绩')}</button></div><label class="filter"><input type="checkbox" id="wrong-only" ${onlyWrong?'checked':''}>${T('只看错题与未答题')}</label>
 ${review.filter(q=>!onlyWrong||!result.grading.find(g=>g.id===q.id)?.correct).map(q=>{const g=result.grading.find(v=>v.id===q.id);return `<article class="review-item"><span class="badge ${g.correct?'correct':'incorrect'}">${T(g.correct?'正确':g.answered?'错误':'未答')} · ${q.id}</span><h2>${esc(content(q).prompt)}</h2>${q.diagram?diagram(q.diagram,T):''}<p>${T('我的答案')}：${readableAnswer(q,result.answers[q.id])}</p><p class="correct-answer">${T('标准答案')}：${readableAnswer(q,q.answer)}</p><p class="explanation">${esc(content(q).explanation)}</p></article>`;}).join('')}</section></main>`;
}
async function loadHistory() {try {history=(await api('history')).rows;render();}catch(e){fail(e);}}
function historyPage() {return `<main class="results panel"><div class="section-heading"><h1>${T('历史练习')}</h1><button data-action="${attempt?'exam':'start'}">${T(attempt?'继续答题':'开始新练习')}</button></div>${history.map(r=>`<button class="history-row" data-review-id="${r.id}"><span>${new Date(r.submitted_at).toLocaleString(lang)}</span><strong>${r.score} / 100</strong><time>${formatTime(r.elapsed_seconds*1000)}</time><span>→</span></button>`).join('')||`<p class="empty">${T('还没有已提交的练习记录。')}</p>`}</main>`;}
function render() {
 document.documentElement.lang=lang;document.title=lang==='zh-TW'?'知澳 · 澳門複習室':'知澳 · 澳门复习室';
 root.innerHTML=header()+(page==='restoring'?`<main class="results panel"><h2>${T('正在恢复你的练习…')}</h2><p>${T('正在读取云端进度与计时，请稍候。')}</p><button data-action="reload">${T('重试连接')}</button></main>`:page==='login'?login():page==='exam'?exam():page==='result'?resultPage():page==='review'?reviewPage():page==='history'?historyPage():`<main class="results"><button class="back" data-action="${attempt?'exam':'history'}">← ${T(attempt?'继续答题':'历史练习')}</button>${leaderboard()}</main>`)+
 `${notice&&page!=='login'&&page!=='exam'?`<div class="toast" role="alert">${T(notice)}</div>`:''}<footer>${T('知澳 · 城市与生活的知识地图')}</footer><dialog id="submit-dialog"><h2>${T('准备好交卷了吗？')}</h2><p>${T('已答')} ${count()} ${T('题，未答')} ${100-count()} ${T('题。未答题计0分；交卷后不能修改。')}</p><p class="muted">${T('确认后冻结本机计时。若断网，最终用时以服务器首次接收为准。')}</p><div class="actions"><button data-action="cancel">${T('返回继续答题')}</button><button class="primary" data-action="submit">${T('确认交卷')}</button></div></dialog>`;
}
async function submit() {
 if(submitBusy) return;
 submitBusy=true;
 if(!pending) {pending={answers:structuredClone(answers),elapsed:elapsed()};persist();}
 render();clearTimeout(saveTimer);
 // Wait for an already-issued save to settle, then use its returned revision.
 while(saveBusy) await new Promise(r=>setTimeout(r,50));
 if(conflict) {submitBusy=false;render();return;}
 try {
   const data=await api('submit',{id:attempt.id,revision:attempt.revision,answers:pending.answers});
   await showResult(data.attempt);
 } catch(error) {persist();fail(error);}
 finally {submitBusy=false;render();}
}
root.addEventListener('submit',async event=>{
 if(event.target.id!=='login-form')return;event.preventDefault();
 const form=new FormData(event.target),button=event.target.querySelector('[type=submit]');button.disabled=true;
 try {
  const data=await api('login',{account:form.get('account'),password:form.get('password')});
  token=data.token;sessionStorage.setItem('macau-token',token);notice='';restore(data);
 }catch(error){fail(error);}
});
root.addEventListener('input',event=>{
 if(event.target.id==='answer') changeAnswer(event.target.value);
});
root.addEventListener('change',event=>{
 const input=event.target,q=questions[current];
 if(input.name==='option') {
  changeAnswer(q.type==='multi'?[...document.querySelectorAll('[name=option]:checked')].map(v=>v.value):input.value);
  document.querySelectorAll('.choice').forEach(v=>v.classList.toggle('selected',v.querySelector('input').checked));
 }
 if(input.dataset.match!==undefined) {const a={...(answers[q.id]||{})};if(input.value)a[input.dataset.match]=input.value;else delete a[input.dataset.match];changeAnswer(Object.keys(a).length?a:undefined);}
 if(input.id==='wrong-only'){onlyWrong=input.checked;render();}
});
root.addEventListener('click',async event=>{
 const button=event.target.closest('button,a[data-action]');if(!button||button.disabled)return;
 if(button.tagName==='A')event.preventDefault();
 if(button.dataset.jump!==undefined){current=Number(button.dataset.jump);persist();render();$('.question-card')?.scrollIntoView({block:'start',behavior:'auto'});return;}
 if(button.dataset.order!==undefined){changeAnswer([...(answers[questions[current].id]||[]),button.dataset.order]);render();return;}
 if(button.dataset.remove!==undefined){changeAnswer((answers[questions[current].id]||[]).filter((_,i)=>i!==Number(button.dataset.remove)));render();return;}
 try {
 if(button.dataset.reviewId) {const data=await api('review',{id:button.dataset.reviewId});result=data.attempt;review=data.questions;page='review';render();return;}
 switch(button.dataset.action){
 case 'language':{
   const loginAccount=$('#account')?.value,loginPassword=$('#password')?.value;
   lang=lang==='zh-CN'?'zh-TW':'zh-CN';localStorage.setItem('macau-language',lang);render();
   if($('#account')){$('#account').value=loginAccount||'';$('#password').value=loginPassword||'';}break;}
 case 'password':{const p=$('#password');p.type=p.type==='password'?'text':'password';button.textContent=lang==='zh-TW'?convert(p.type==='password'?'显示':'隐藏'):(p.type==='password'?'显示':'隐藏');button.setAttribute('aria-label',button.textContent);break;}
 case 'previous':current=Math.max(0,current-1);persist();render();break;
 case 'next':current=Math.min(99,current+1);persist();render();break;
 case 'clear':delete answers[questions[current].id];dirty=true;persist();scheduleSave();render();break;
 case 'confirm':$('#submit-dialog').showModal();break;
 case 'cancel':$('#submit-dialog').close();break;
 case 'submit':await submit();break;
 case 'retry':await submit();break;
 case 'board':page='board';render();await loadBoard();break;
 case 'refresh-board':await loadBoard();break;
 case 'exam':page='exam';render();break;
 case 'home':if(token){page=attempt?'exam':'history';render();}break;
 case 'history':page='history';render();await loadHistory();break;
 case 'review':{const data=await api('review',{id:result.id});review=data.questions;page='review';render();break;}
 case 'result':page='result';render();await loadBoard();break;
 case 'start':notice='';restore(await api('start'));break;
 case 'reload':restore(await api('state'));break;
 case 'resolve':{localStorage.setItem(key()+':backup',localStorage.getItem(key())||'');localStorage.removeItem(key());notice='';restore(await api('state'));break;}
 case 'keep-local':{
   const localDraft=JSON.parse(localStorage.getItem(key())||'null');
   const data=await api('state');
   if(data.attempt?.id!==attempt.id){notice='这次练习已在其他设备交卷，请从历史练习查看成绩。';restore(data);break;}
   localStorage.setItem(key()+':cloud-backup',JSON.stringify(data.attempt.answers));
   attempt=data.attempt;answers=localDraft?.answers||answers;pending=localDraft?.pending||pending;
   dirty=true;conflict=false;notice='';persist();render();if(!pending)scheduleSave();break;
 }
 case 'logout':
   await save();await api('logout');persist();token='';account='';sessionStorage.removeItem('macau-token');page='login';notice='';render();break;
 }
 }catch(error){fail(error);}
});
setInterval(()=>{if($('#timer'))$('#timer').textContent=formatTime(elapsed());},1000);
setInterval(()=>{if(token&&['board','result'].includes(page))loadBoard();},60000);
document.addEventListener('visibilitychange',async()=>{
 if(document.hidden){persist();return;}
 if(!token)return;
 if(['board','result'].includes(page))loadBoard();
 if(attempt&&!pending){
  try {const data=await api('state');if(data.attempt?.id===attempt.id&&data.attempt.revision!==attempt.revision){conflict=true;notice=message('CONFLICT');render();}}
  catch(error){notice=message(error.code);updateProgress();}
 }
});
window.addEventListener('online',()=>{if(pending&&token)submit();else if(dirty)save();if(['board','result'].includes(page))loadBoard();});
window.addEventListener('pagehide',persist);
render();
if(token) api('state').then(restore).catch(fail);
