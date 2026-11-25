
'use strict';
const ST='edunest_mlb:';
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lset=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const own=e=>/^(INPUT|TEXTAREA)$/.test((e&&e.tagName)||'');
/* protection, as in mashq.html */
document.addEventListener('contextmenu',e=>{if(!own(e.target))e.preventDefault()});
document.addEventListener('copy',e=>{if(!own(document.activeElement))e.preventDefault()});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&/^[spu]$/i.test(e.key))e.preventDefault()});

let SESSION=null;try{SESSION=JSON.parse(ls(ST+'session')||'null')}catch(e){}
const UID=SESSION&&SESSION.id||'anon';
function who(){let p=null;try{p=JSON.parse(ls(ST+'p:'+UID)||'null')}catch(e){}const n=p&&p.student?p.student.name:'';return (n||'EDUNEST')+(p&&p.student&&p.student.id?' · '+p.student.id:'')}
function watermark(){const t=esc(who());const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='340' height='210'><text x='10' y='120' transform='rotate(-22 170 105)' font-family='Arial' font-size='15' font-weight='700' fill='rgba(20,27,45,0.055)'>${t}</text></svg>`;
  document.documentElement.style.setProperty('--wm',`url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`)}

/* ---------- address: #d=<doc>&x=<section>  (+ &a=<map>&s=<step>&sx=<the step's section> when opened from a map) ---------- */
const hp=()=>Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
let H=hp();
const DID=H.d||'';
const STEP=H.a&&H.s!=null&&H.s!==''?{a:H.a,s:+H.s,x:H.sx||H.x||''}:null;
const isStep=x=>!!STEP&&STEP.x===x;
function link(x){const p=new URLSearchParams();p.set('d',DID);if(x)p.set('x',x);if(STEP){p.set('a',STEP.a);p.set('s',String(STEP.s));if(STEP.x)p.set('sx',STEP.x)}return '#'+p.toString()}
function go(x){const h=link(x);if(location.hash===h)route();else location.hash=h}
function goDone(){location.href='./#/me/a/'+encodeURIComponent(STEP.a)+'/done/'+STEP.s}
const OPENED=Date.now();

/* every finished exercise goes to the teacher (25.11.2026): queued in this browser, re-sent until the server has it (stored once per cid) */
const CLOUD_URL="https://tuffyskazbkbezsghgtk.supabase.co/functions/v1/api";
const RQ=ST+'rq:'+UID;let rqBusy=false;
const isStu=()=>!!(SESSION&&SESSION.t&&SESSION.id&&SESSION.role!=='teacher');
async function rqFlush(){if(!isStu()||rqBusy)return;let q=[];try{q=JSON.parse(ls(RQ)||'[]')}catch(e){}if(!q.length)return;rqBusy=true;const sent=[];
  for(const b of q){try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),20000);
    const r=await fetch(CLOUD_URL,{method:'POST',body:JSON.stringify(Object.assign({},b,{action:'res',id:SESSION.id,t:SESSION.t,v:'ml'})),signal:ctl.signal});clearTimeout(t);
    const j=await r.json();if(j&&(j.ok||j.error==='bad'))sent.push(b.cid)}catch(e){}}
  let now=[];try{now=JSON.parse(ls(RQ)||'[]')}catch(e){}const left=now.filter(b=>!sent.includes(b.cid));
  if(left.length)lset(RQ,JSON.stringify(left));else try{localStorage.removeItem(RQ)}catch(e){}rqBusy=false}
function sendRes(b){if(!isStu())return;let q=[];try{q=JSON.parse(ls(RQ)||'[]')}catch(e){}
  b.cid=Date.now().toString(36)+Math.random().toString(36).slice(2,8);q.push(b);lset(RQ,JSON.stringify(q.slice(-40)));rqFlush()}
addEventListener('online',rqFlush);setTimeout(rqFlush,1500);

/* ---------- content: the same encrypted <doc>.bin as mashq.html ---------- */
async function sha8(s){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));return [...h.slice(0,4)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function decrypt(buf){
  const K=ls(ST+'k');if(!K)throw new Error('nokey');
  if(String.fromCharCode(...buf.slice(0,4))!=='EDN1')throw new Error('bad');
  const salt=buf.slice(4,20),sk=ST+'dk:'+(await sha8(K))+':'+btoa(String.fromCharCode(...salt));let key=null;
  try{const c=sessionStorage.getItem(sk);if(c)key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(c),x=>x.charCodeAt(0)),'AES-GCM',false,['decrypt'])}catch(e){}
  if(!key){  /* the 150 000-round key derivation is slow on phones: once per tab session (shared with mashq.html) */
    const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(K),'PBKDF2',false,['deriveKey']);
    const k2=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,['decrypt']);
    try{sessionStorage.setItem(sk,btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw',k2)))))}catch(e){}
    key=k2}
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(20,32)},key,buf.slice(32)));
}
async function load(name){let r;try{r=await fetch(name+'.bin',{cache:'no-cache'})}catch(e){throw new Error('net')}if(!r.ok)throw new Error('net');return decrypt(new Uint8Array(await r.arrayBuffer()))}

/* answer checking: the same rules as mashq.html */
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’‘`]/g,"'").replace(/[£$€]/g,'').replace(/[.,;:!?]+$/,'').replace(/\bcan't\b/g,'cannot').replace(/won't\b/g,'will not').replace(/n't\b/g,' not').replace(/'ve\b/g,' have').replace(/'re\b/g,' are').replace(/'m\b/g,' am').replace(/'ll\b/g,' will').replace(/\s+/g,' ').trim();
const isOk=(v,acc)=>!!norm(v)&&acc.some(a=>norm(a)===norm(v));
/* markers: \x01..\x02 bold, \x03..\x04 italic, \x05..\x06 highlight, \x0e..\x0f red text, \x10..\x11 strikethrough */
const rich=x=>esc(x).replace(/\x01/g,'<b>').replace(/\x02/g,'</b>').replace(/\x03/g,'<i>').replace(/\x04/g,'</i>').replace(/\x05/g,'<mark class="hl">').replace(/\x06/g,'</mark>').replace(/\x0e/g,'<span class="rd">').replace(/\x0f/g,'</span>').replace(/\x10/g,'<s>').replace(/\x11/g,'</s>');
const CTRL=/[\x01-\x06\x0e-\x11]/g;

function toast(m){let d=$('#toast');if(!d){d=document.createElement('div');d.id='toast';d.className='toast';d.setAttribute('role','status');document.body.appendChild(d)}d.textContent=m;d.style.opacity=1;clearTimeout(d._t);d._t=setTimeout(()=>d.style.opacity=0,3200)}
function fail(h,p,back){$('#main').innerHTML=`<div class="msg"><h2>${esc(h)}</h2><p>${esc(p)}</p><a href="${back||'./#/login'}">${back?'Xaritaga qaytish':'Platformaga kirish'}</a></div>`;$('#foot').hidden=true}
function setBar(t,s){$('#ttl').textContent=t;$('#sub').textContent=s;document.title='EDUNEST · '+t}
function foot(btns){const f=$('#footin');$('#foot').hidden=!btns.length;
  f.innerHTML=btns.map((b,i)=>`<button type="button" class="${b.cls||''}" data-i="${i}" ${b.dis?'disabled':''}>${esc(b.t)}</button>`).join('');
  f.querySelectorAll('button').forEach(x=>x.onclick=()=>btns[+x.dataset.i].f())}

/* saved on this device; the same key as mashq.html, so the map's "Bajardim" check (stepProof) reads it:
   exercise {a: answers, k: checked items, r: {ok, of, res} when finished, best}; lesson {c: card, seen, v: finished at} */
const skey=x=>ST+'mashq:'+UID+':'+DID+':'+x;
function sget(x){try{const o=JSON.parse(ls(skey(x))||'null');return o&&typeof o==='object'?o:{}}catch(e){return {}}}
function sput(x,o){lset(skey(x),JSON.stringify(o))}

let DOC=null,VIEW='';
const NOTE=()=>DOC.sections.find(s=>s.kind==='note')||null;
const EXS=()=>DOC.sections.filter(s=>s.kind==='read'&&Object.keys(s.ans||{}).length);
function cardsOf(){
  if(Array.isArray(DOC.lesson)&&DOC.lesson.length)return DOC.lesson;
  const n=NOTE();if(!n)return [];const cards=[];   /* a topic without lesson cards: one card per heading */
  n.blocks.forEach(b=>{const lines=b.t==='h'?[['h',b.x]]:String(b.x||'').split('\n').map(l=>['p',l]);
    if(b.t==='h'||!cards.length)cards.push({id:'c'+(cards.length+1),parts:[]});cards[cards.length-1].parts.push(...lines)});
  return cards}
function itemsOf(sec){const out=[],nt=sec.notes||{};
  (sec.blocks||[]).forEach(b=>{if(b.t!=='row')return;const ns=[...String(b.x).matchAll(/\{\{(\d+)\}\}/g)].map(m=>m[1]);if(ns.length)out.push({t:'gap',x:b.x,ns,note:nt[ns[0]]||''})});
  (sec.qs||[]).forEach(q=>{if(q.t==='mcq')out.push({t:'mcq',q:q.q,o:q.o,n:String(q.n),note:nt[q.n]||''})});
  return out}
const enOf=sec=>((sec.blocks||[]).find(b=>b.t==='sub')||{}).x||'';
const crumb=()=>`<a class="crumb" href="${link('')}">‹ <span>${esc(DOC.title)}</span></a>`;

/* ================= topic page ================= */
const BOOK='<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 7h8M8 11h6"/></svg>';
function exState(s){const st=sget(s.id),items=itemsOf(s),n=items.length;fromOld(s,items,st);const k=Object.keys(st.k||{}).length;
  if(st.r){const pc=st.r.ok/st.r.of;return{st,n,cls:pc>=.8?'g':pc>=.5?'y':'r',txt:st.r.ok+'/'+st.r.of}}
  return{st,n,cls:k?'b':'',txt:k?'Davom etmoqda':'Yangi'}}
function hubView(){
  VIEW='hub';setBar(DOC.short||'Grammatika',DOC.title);
  const note=NOTE(),cards=cardsOf(),exs=EXS(),ln=note?sget(note.id):{};
  const xs=exs.map(s=>({s,...exState(s)}));const dEx=xs.filter(x=>x.st.r).length;
  const total=(note?1:0)+exs.length,dAll=(ln.v?1:0)+dEx,pc=total?Math.round(dAll/total*100):0;
  $('#main').innerHTML=`<section class="hero"><span class="eb">${esc(DOC.short||'Grammatika')}</span><h1>${esc(DOC.title)}</h1>
      <p>${note?'Avval darsni o‘qing, keyin mashqlarni bajaring. ':''}Har bir javob darhol tekshiriladi va o‘zbekcha tushuntiriladi.</p>
      <div class="hstats"><div><b>${note?(ln.v?'✓':cards.length):'–'}</b><span>${note?(ln.v?'dars o‘qildi':'dars qismi'):'dars yo‘q'}</span></div><div><b>${dEx}/${exs.length}</b><span>mashq bajarildi</span></div><div><b>${pc}%</b><span>umumiy</span></div></div>
      <div class="hbar"><b style="width:${pc}%"></b></div></section>
    ${note?`<h2 class="sech">Dars</h2><a class="lcard" href="${link(note.id)}"><span class="lic">${BOOK}</span><span class="ltx"><b>${esc(DOC.title)}</b><small>${cards.length} qism: qoida, formula, misollar va mini-testlar</small></span><span class="st ${ln.v?'g':ln.c?'b':''}">${ln.v?'O‘qildi ✓':ln.c?'Davom etmoqda':'Yangi'}</span></a>`:''}
    ${exs.length?`<h2 class="sech">Mashqlar</h2><div class="xlist">${xs.map((x,i)=>`<a class="xitem" href="${link(x.s.id)}"><span class="xn">${i+1}</span><span class="xt"><b>${esc(x.s.title)}</b><small>${x.n} ta savol${x.st.best&&x.st.r&&(x.st.best.ok>x.st.r.ok)?' · eng yaxshi: '+x.st.best.ok+'/'+x.st.best.of:''}</small></span><span class="st ${x.cls}">${esc(x.txt)}</span></a>`).join('')}</div>`:''}`;
  watermark();
  const nx=xs.find(x=>!x.st.r);
  if(note&&!ln.v)foot([{t:ln.c?'Darsni davom ettirish →':'Darsni boshlash →',f:()=>go(note.id)}]);
  else if(nx)foot([{t:`${nx.s.label} →`,f:()=>go(nx.s.id)}]);
  else foot([{t:'Xaritaga qaytish',f:()=>{location.href=$('#back').href}}]);
}

/* ================= lesson ================= */
let LI=0;const QA={};
function chipKind(p){const s=p.trim().toLowerCase();if(s==='subject'||s==='s')return 's';if(/^verb\b/.test(s))return 'v';if(s==='obj'||s==='object')return 'o';if(s==='wh-word')return 'w';return 'x'}
function formula(x,noLabel){   /* his formula line, word for word, shown as coloured parts */
  let t=String(x).replace(CTRL,''),lab='',cap='',q='';
  const ci=t.indexOf(': '),pi=t.indexOf(' + ');if(ci>0&&pi>ci){lab=t.slice(0,ci+1);t=t.slice(ci+2)}
  const m=/\s*\(([^)]*)\)\s*$/.exec(t);if(m){cap=m[1];t=t.slice(0,m.index)}
  if(/\?$/.test(t)){q='?';t=t.slice(0,-1)}
  const chips=t.split(' + ').map(p=>`<span class="ch ${chipKind(p)}">${esc(p)}</span>`).join('<span class="pl">+</span>');
  return `<div class="f">${lab&&!noLabel?`<span class="flab">${esc(lab)}</span>`:''}<div class="fr">${chips}${q?'<span class="fq">?</span>':''}</div>${cap?`<span class="fcap">(${esc(cap)})</span>`:''}</div>`}
function partsHTML(parts){let h='',i=0;
  while(i<parts.length){const r=parts[i][0],x=parts[i][1];
    if(r==='c'||r==='e'){let j=i;while(j<parts.length&&parts[j][0]===r)j++;const g=parts.slice(i,j).map(p=>p[1]);
      h+=r==='c'?`<div class="cc">${g.map(l=>`<span>${rich(l)}</span>`).join('')}</div>`
        :`<div class="exs"><span class="el">${g.length>1?'Misollar':'Misol'}</span>${g.map(l=>`<p class="e">${rich(l)}</p>`).join('')}</div>`;
      i=j;continue}
    if(r==='h')h+=`<h3 class="sh">${rich(x)}</h3>`;
    else if(r==='k')h+=`<div class="k">${rich(x)}</div>`;
    else if(r==='f')h+=formula(x);
    else if(r==='v'){const ci=x.indexOf(': ');h+=`<div class="vp">${ci>0?`<span>${esc(x.slice(0,ci+1))}</span><b>${esc(x.slice(ci+2))}</b>`:`<b>${rich(x)}</b>`}</div>`}
    else if(r==='w'){const ci=x.indexOf(': ');h+=ci>0?`<div class="wl"><span class="flab">${esc(x.slice(0,ci+1))}</span><div class="wc">${x.slice(ci+2).split(', ').map(w=>`<span>${esc(w)}</span>`).join('')}</div></div>`:`<p class="p">${rich(x)}</p>`}
    else if(r==='u')h+=`<div class="u">${rich(x)}</div>`;
    else h+=`<p class="p">${rich(x)}</p>`;
    i++}
  return h}
function timeline(k){   /* ours: a simple time line (past → now) */
  const one=k==='one',dots=one?[140]:[52,92,132,172,212],lbl=one?'bir marta':'takror-takror';
  return `<figure class="tl" aria-label="Vaqt chizig‘i: ${lbl}${k==='many-no'?', hozir endi yo‘q':''}"><svg viewBox="0 0 340 96" role="img" aria-hidden="true">
    <line x1="14" y1="60" x2="320" y2="60" class="ax"/><path d="M326 60l-9-5.5v11z" class="ar"/>
    <line x1="282" y1="42" x2="282" y2="78" class="now"/>
    <text x="14" y="90" class="tx">o‘tmish</text><text x="282" y="92" class="tx" text-anchor="middle">hozir</text>
    ${dots.map(x=>`<circle cx="${x}" cy="60" r="7" class="dt"/>`).join('')}
    <text x="${one?140:132}" y="34" class="t1" text-anchor="middle">${lbl}</text>
    ${k==='many-no'?'<path d="M275 53l14 14M289 53l-14 14" class="nx"/><text x="282" y="30" class="no" text-anchor="middle">endi yo‘q</text>':''}</svg></figure>`}
const LEGEND=`<div class="flegend" aria-hidden="true"><span><i style="background:#E9F0FE;box-shadow:inset 0 0 0 1.5px #BFD0FA"></i>ega</span><span><i style="background:#13254A"></i>yordamchi so‘z</span><span><i style="background:#FDE8E9;box-shadow:inset 0 0 0 1.5px #F6C2C6"></i>fe’l</span><span><i style="background:#fff;box-shadow:inset 0 0 0 1.5px #DCE1EA"></i>to‘ldiruvchi</span></div>`;
function cardHTML(c,i,n){
  const parts=c.parts||[],hasH=parts.length&&parts[0][0]==='h',title=hasH?parts[0][1]:(c.title||'');
  const body=partsHTML(hasH?parts.slice(1):parts),hasF=parts.some(p=>p[0]==='f')||!!c.fx;
  return `<article class="card" data-c="${i}"><div class="ceb"><span>${i+1}-qism</span><i>${esc(DOC.short||'Grammatika')}</i></div>
    <h2>${rich(title)}</h2>${hasF&&i===0?LEGEND:''}${body}
    ${c.tl?timeline(c.tl):''}
    ${c.tbl?`<div class="vt"><h3>Bu mavzudagi Irregular fe’llar</h3><div class="g">${c.tbl.map(r=>`<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div></div>`:''}
    ${c.cmp?`<div class="cmpw"><table class="cmp"><thead><tr>${c.cmp.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${c.cmp.rows.map(r=>`<tr><th scope="row">${esc(r[0])}<small>${esc(r[4]||'')}</small></th>${[1,2,3].map(j=>`<td class="${r[j]?'y':'n'}" aria-label="${r[j]?'ha':'yo‘q'}">${r[j]?'✓':'✗'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}
    ${c.fx?`<div class="fx"><h3>Formulalar</h3>${c.fx.map(f=>`<div class="fxr"><span>${esc(f[0])}</span>${formula(f[1],true)}</div>`).join('')}</div>`:''}
    ${c.tip?`<div class="tip"><b>Diqqat</b><p>${esc(c.tip)}</p></div>`:''}
    ${(c.chk||[]).length?`<section class="chk" aria-label="Tekshirib ko‘ring"><h3><span>?</span>Tekshirib ko‘ring</h3>${c.chk.map((x,qi)=>chkQ(c,x,qi)).join('')}</section>`:''}
  </article>`}
function chkFb(x,a){const ok=a===x.r;return `<div class="cf ${ok?'ok':'bad'}" role="status"><b>${ok?'✓ To‘g‘ri!':'✗ Xato. To‘g‘ri javob: '+esc(x.o[x.r])}</b>${rich(x.n)}</div>`}
function chkQ(c,x,qi){const k=c.id+':'+qi,a=QA[k];
  return `<div class="cq" data-k="${k}" data-qi="${qi}"><p>${esc(x.q)}</p><div class="co">${x.o.map((o,oi)=>`<button type="button" data-o="${oi}" class="${a!=null?(oi===x.r?'right':oi===a?'wrong':''):''}" ${a!=null?'disabled':''}>${esc(o)}</button>`).join('')}</div>${a!=null?chkFb(x,a):''}</div>`}
function bindChk(c){(c.chk||[]).length&&document.querySelectorAll('.cq').forEach(el=>{const x=c.chk[+el.dataset.qi];
  el.querySelectorAll('button[data-o]').forEach(b=>b.onclick=()=>{if(QA[el.dataset.k]!=null)return;const a=+b.dataset.o;QA[el.dataset.k]=a;
    el.querySelectorAll('button[data-o]').forEach(y=>{y.disabled=true;const o=+y.dataset.o;if(o===x.r)y.classList.add('right');else if(o===a)y.classList.add('wrong')});
    el.insertAdjacentHTML('beforeend',chkFb(x,a))})})}
function lessonView(){const note=NOTE(),cards=cardsOf();if(!note||!cards.length){go('');return}
  const st=sget(note.id);LI=Math.min(Math.max(+st.c||0,0),cards.length-1);drawCard()}
function drawCard(){
  VIEW='lesson';const note=NOTE(),cards=cardsOf(),n=cards.length,c=cards[LI],st=sget(note.id);
  st.c=LI;st.seen=[...new Set([...(st.seen||[]),c.id])];sput(note.id,st);
  setBar((DOC.short||'Grammatika')+' · Dars',DOC.title);
  $('#main').innerHTML=`${crumb()}<div class="lnav"><div class="dots">${cards.map((x,i)=>`<button type="button" data-i="${i}" class="${i===LI?'on':st.seen.includes(x.id)?'seen':''}" aria-label="${i+1}-qism"${i===LI?' aria-current="step"':''}></button>`).join('')}</div><span class="cnt">${LI+1} / ${n}</span></div>${cardHTML(c,LI,n)}`;
  watermark();bindChk(c);
  document.querySelectorAll('.dots button').forEach(b=>b.onclick=()=>{LI=+b.dataset.i;drawCard();scrollTo(0,0)});
  const last=LI===n-1;
  foot([LI>0?{t:'← Oldingi',cls:'alt',f:lessonPrev}:{t:'‹ Mavzu',cls:'alt',f:()=>go('')},
    last?{t:'Darsni tugatdim ✓',cls:'ok',f:finishLesson}:{t:'Keyingi →',f:lessonNext}]);
}
function lessonNext(){const n=cardsOf().length;if(LI<n-1){LI++;drawCard();scrollTo(0,0)}else finishLesson()}
function lessonPrev(){if(LI>0){LI--;drawCard();scrollTo(0,0)}}
function finishLesson(){
  const note=NOTE(),st=sget(note.id),ex=EXS();
  if(isStep(note.id)&&!st.v&&Date.now()-OPENED<60000){toast('Avval darsni o‘qib chiqing. Kamida 1 daqiqa ishlang.');return}
  if(!st.v){st.v=Date.now();sput(note.id,st)}
  VIEW='fin';
  $('#main').innerHTML=`${crumb()}<div class="card fin"><div class="big" aria-hidden="true">🎉</div><h2>Dars tugadi!</h2>
    <p>${isStep(note.id)?'“Bajardim” tugmasini bosing: bosqich xaritada belgilanadi va keyingisi ochiladi.':ex.length?`Endi ${ex.length} ta mashqda o‘zingizni sinab ko‘ring.`:'Qoidani yaxshilab takrorlang.'}</p></div>`;
  watermark();scrollTo(0,0);
  if(isStep(note.id))foot([{t:'Qayta o‘qish',cls:'alt',f:()=>{LI=0;drawCard();scrollTo(0,0)}},{t:'Bajardim',f:goDone}]);
  else foot([{t:'‹ Mavzu',cls:'alt',f:()=>go('')},ex.length?{t:`${ex[0].label}ni boshlash →`,f:()=>go(ex[0].id)}:{t:'Qayta o‘qish',f:()=>{LI=0;drawCard()}}]);
}

/* ================= exercises: one question at a time, checked at once ================= */
let XS=null;   /* {sec, items, st, run:{list, A, K, pos, prac}} */
const blankQ=q=>esc(q).replace(/_{3,}/g,'<span class="blank" aria-label="bo‘sh joy"></span>');
const gapIn=n=>`<input class="gap" data-n="${n}" aria-label="Javob" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">`;
function solved(sec,it){   /* the sentence with the right answers in it */
  const s=esc(it.x).replace(/\{\{(\d+)\}\}/g,(_,n)=>`<b>${esc((sec.ans[n]||[''])[0])}</b>`);
  return s.replace(/^(\s*<b>)([a-z])/,(_,a,c)=>a+c.toUpperCase())}
function checkItem(sec,it,A){if(it.t==='mcq'){const ok=A[it.n]===sec.ans[it.n][0];return{ok,per:{[it.n]:ok}}}
  const per={};it.ns.forEach(n=>per[n]=isOk(A[n],sec.ans[n]));return{ok:it.ns.every(n=>per[n]),per}}
/* a result saved by the old mashq page (grammar lived there until 20.11.2026) is counted per blank:
   turn it into this page's per-question form once (same answers, same keys; only the counting changes) */
function fromOld(sec,items,st){if(!st.r||st.k||!st.r.res)return;
  const k={},res={};let ok=0;
  items.forEach((it,j)=>{const per={};(it.t==='mcq'?[it.n]:it.ns).forEach(n=>per[n]=!!st.r.res[n]);const g=Object.values(per).every(Boolean);k[j]={ok:g,per};res[j]=g;if(g)ok++});
  st.k=k;st.r={ok,of:items.length,res};st.best={ok,of:items.length};st.at=st.at||Date.now();sput(sec.id,st)}
function exView(sec){
  const items=itemsOf(sec),st=sget(sec.id);st.a=st.a||{};fromOld(sec,items,st);st.k=st.k||{};
  XS={sec,items,st,run:null,t0:Date.now()};
  if(st.r){exResult();return}
  const list=items.map((_,j)=>j);const first=list.findIndex(j=>!st.k[j]);
  XS.run={list,A:st.a,K:st.k,pos:first<0?0:first,prac:false};
  if(first<0){finishRun();return}
  exDraw()}
function exDraw(){
  VIEW='ex';const {sec,items,run}=XS,j=run.list[run.pos],it=items[j],k=run.K[j],A=run.A;
  setBar((DOC.short||'Grammatika')+' · '+sec.label,sec.title);
  const okN=run.list.filter(x=>run.K[x]&&run.K[x].ok).length;
  $('#main').innerHTML=`${crumb()}<div class="xh"><b>${esc(sec.label)}${run.prac?' · xatolar ustida ishlash':''}</b><h2>${esc(sec.title)}</h2><p>${esc(sec.instr)}</p>${enOf(sec)?`<p class="en">${esc(enOf(sec))}</p>`:''}</div>
    <div class="xp">${run.list.map((x,p)=>{const kk=run.K[x];return `<button type="button" data-p="${p}" class="${kk?(kk.ok?'ok':'bad'):''}${p===run.pos?' on':''}" aria-label="${p+1}-savol" ${kk||p===run.pos?'':'disabled'}></button>`}).join('')}</div>
    <article class="card it"><div class="itn"><span>${run.prac?'Xato':'Savol'} ${run.pos+1} / ${run.list.length}</span><em>✓ ${okN}</em></div>
      ${it.t==='gap'?`<p class="itx">${esc(it.x).replace(/\{\{(\d+)\}\}/g,(_,n)=>gapIn(n))}</p>`
        :`<p class="itx">${blankQ(it.q)}</p><div class="opts">${it.o.map(([L,t])=>`<button type="button" class="opt" data-v="${esc(L)}"><i>${esc(L.toUpperCase())}</i><span>${esc(t)}</span></button>`).join('')}</div>`}
      <div id="fb"></div></article>`;
  watermark();
  document.querySelectorAll('.xp button').forEach(b=>b.onclick=()=>{run.pos=+b.dataset.p;exDraw()});
  const ins=[...document.querySelectorAll('input.gap')];
  ins.forEach(i=>{const a=(sec.ans[i.dataset.n]||[''])[0];i.style.width=Math.max(5,Math.min(22,a.length+2))*.62+'em';i.value=A[i.dataset.n]||'';
    i.addEventListener('input',()=>{A[i.dataset.n]=i.value;if(!run.prac)sput(sec.id,XS.st);exFoot()});
    i.addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();const nx=ins[ins.indexOf(i)+1];
      if(nx&&!norm(nx.value))nx.focus();else if(ins.every(x=>norm(x.value)))exCheck();else(ins.find(x=>!norm(x.value))||i).focus()})});
  document.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{if(run.K[j])return;A[it.n]=b.dataset.v;exCheck()});
  if(k)exShow();else{exFoot();if(ins[0]&&matchMedia('(hover:hover)').matches)ins[0].focus()}
}
function exCheck(){const {sec,items,run}=XS,j=run.list[run.pos],it=items[j];if(run.K[j])return;
  if(it.t==='gap'&&!it.ns.every(n=>norm(run.A[n]))){toast('Avval bo‘sh joyni to‘ldiring.');return}
  run.K[j]=checkItem(sec,it,run.A);if(!run.prac)sput(sec.id,XS.st);exDraw()}
function exShow(){   /* the checked item: colours, the right answer, the explanation */
  const {sec,items,run}=XS,j=run.list[run.pos],it=items[j],k=run.K[j],A=run.A;
  document.querySelectorAll('input.gap').forEach(i=>{i.disabled=true;i.classList.add(k.per[i.dataset.n]?'ok':'bad')});
  document.querySelectorAll('.opt').forEach(b=>{b.disabled=true;if(b.dataset.v===sec.ans[it.n][0])b.classList.add('right');else if(b.dataset.v===A[it.n])b.classList.add('wrong')});
  const right=it.t==='gap'?solved(sec,it):(()=>{const o=it.o.find(x=>x[0]===sec.ans[it.n][0]);return o?`${esc(o[0].toUpperCase())}) <b>${esc(o[1])}</b>`:''})();
  $('#fb').innerHTML=`<div class="fb ${k.ok?'ok':'bad'}" role="status"><b>${k.ok?'✓ To‘g‘ri!':'✗ Xato'}</b>${k.ok&&it.t==='mcq'?'':`<p class="an">${k.ok?'':'To‘g‘ri javob: '}${right}</p>`}${it.note?`<div class="nt"><span>Tahlil</span>${rich(it.note)}</div>`:''}</div>`;
  exFoot()}
function nextOpen(){const {run}=XS;for(let p=run.pos+1;p<run.list.length;p++)if(!run.K[run.list[p]])return p;for(let p=0;p<run.pos;p++)if(!run.K[run.list[p]])return p;return -1}
function exFoot(){const {items,run}=XS,j=run.list[run.pos],it=items[j],k=run.K[j];
  const back={t:'‹ Mavzu',cls:'alt',f:()=>go('')};
  if(!k){if(it.t==='mcq')foot([back,{t:'Javobni tanlang',dis:true,f:()=>{}}]);
    else foot([back,{t:'Tekshirish',dis:!it.ns.every(n=>norm(run.A[n])),f:exCheck}]);return}
  const nx=nextOpen();
  foot([back,nx<0?{t:run.prac?'Tugatish':'Natijani ko‘rish',cls:'ok',f:finishRun}:{t:'Keyingi savol →',f:()=>{run.pos=nx;exDraw();scrollTo(0,0)}}])}
function finishRun(){const {sec,items,st,run}=XS;
  if(run.prac){const fixed=run.list.filter(j=>run.K[j]&&run.K[j].ok).length;toast(fixed===run.list.length?'Barakalla! Hamma xatolarni tuzatdingiz.':`${fixed} / ${run.list.length} ta xato tuzatildi.`);exResult();return}
  const res={};items.forEach((_,j)=>res[j]=!!(st.k[j]&&st.k[j].ok));const ok=Object.values(res).filter(Boolean).length;
  st.r={ok,of:items.length,res};st.at=Date.now();
  if(!st.best||ok/items.length>st.best.ok/st.best.of)st.best={ok,of:items.length};
  sput(sec.id,st);
  if(items.length)sendRes({kind:'gr',doc:DID,sec:String(sec.id),aid:STEP?STEP.a:'',step:STEP?STEP.s:null,
    title:(DOC.short||'Grammatika')+' · '+(sec.label||'')+(sec.title?' · '+sec.title:''),ok,of:items.length,secs:Math.round((Date.now()-(XS.t0||OPENED))/1000),
    det:items.map((it,j)=>{const g=!!res[j];
      if(it.t==='mcq'){const o=x=>{const f=it.o.find(y=>y[0]===x);return f?f[0].toUpperCase()+') '+f[1]:(x||'')};return [String(j+1),o(st.a[it.n]),g?1:0,o(sec.ans[it.n][0])]}
      return [String(j+1),it.ns.map(n=>st.a[n]||'').join(' / '),g?1:0,it.ns.map(n=>(sec.ans[n]||[''])[0]).join(' / ')]})});
  exResult()}
function mistHTML(sec,it,j){const st=XS.st,A=st.a,k=st.k[j]||{per:{}};
  if(it.t==='gap'){const q=esc(it.x).replace(/\{\{(\d+)\}\}/g,(_,n)=>k.per[n]?`<b class="r">${esc(A[n]||'')}</b>`:`<span class="w">${esc(A[n]||'—')}</span> <b class="r">${esc((sec.ans[n]||[''])[0])}</b>`);
    return `<div class="mi"><p class="q">${j+1}. ${q}</p>${it.note?`<p class="n">${rich(it.note)}</p>`:''}</div>`}
  const mine=it.o.find(x=>x[0]===A[it.n]),good=it.o.find(x=>x[0]===sec.ans[it.n][0]);
  return `<div class="mi"><p class="q">${j+1}. ${blankQ(it.q)}</p><p>Sizning javobingiz: <span class="w">${esc(mine?mine[1]:'—')}</span> · To‘g‘ri: <b class="r">${esc(good?good[1]:'')}</b></p>${it.note?`<p class="n">${rich(it.note)}</p>`:''}</div>`}
function exResult(){
  VIEW='res';const {sec,items,st}=XS,r=st.r,pc=Math.round(r.ok/r.of*100),exs=EXS(),nx=exs[exs.indexOf(sec)+1];
  const msg=pc===100?'Mukammal! Hammasi to‘g‘ri.':pc>=80?'Juda yaxshi! Xatolarni ko‘rib chiqing.':pc>=50?'Yomon emas. Xatolar ustida ishlang.':'Qoidani yana bir bor o‘qing va qayta urinib ko‘ring.';
  const wrong=items.map((_,j)=>j).filter(j=>!r.res[j]);
  setBar((DOC.short||'Grammatika')+' · '+sec.label,sec.title);
  $('#main').innerHTML=`${crumb()}<div class="card res"><div class="ring" style="--p:${pc};--c:${pc>=80?'var(--ok)':pc>=50?'#D99A00':'var(--bad)'}"><span>${r.ok}/${r.of}</span></div>
    <h2>${esc(sec.label)} · natija</h2><p><b>${msg}</b>${st.best&&st.best.ok>r.ok?`Eng yaxshi natijangiz: ${st.best.ok}/${st.best.of}.`:''}</p>
    <div class="rbtns">${wrong.length?'<button type="button" class="pri" id="prac">Xatolar ustida ishlash</button>':''}<button type="button" id="again">Qaytadan ishlash</button>${NOTE()?'<button type="button" id="rule">Qoidani ko‘rish</button>':''}</div>
    ${wrong.length?`<div class="mist"><h3>Xatolar va tahlil</h3>${wrong.map(j=>mistHTML(sec,items[j],j)).join('')}</div>`:''}</div>`;
  watermark();scrollTo(0,0);
  const pb=$('#prac');if(pb)pb.onclick=()=>{XS.run={list:wrong,A:{},K:{},pos:0,prac:true};exDraw();scrollTo(0,0)};
  $('#again').onclick=()=>{sput(sec.id,st.best?{best:st.best}:{});exView(sec);scrollTo(0,0)};
  const rb=$('#rule');if(rb)rb.onclick=()=>go(NOTE().id);
  const back={t:'‹ Mavzu',cls:'alt',f:()=>go('')};
  if(isStep(sec.id))foot([back,{t:'Bajardim',f:goDone}]);
  else if(nx)foot([back,{t:`${nx.label} →`,f:()=>go(nx.id)}]);
  else foot([back,{t:'Mavzuga qaytish',f:()=>go('')}]);
}

/* ================= router, keys, big-screen mode ================= */
function route(){const x=H.x||'',note=NOTE();
  if(note&&x===note.id)lessonView();
  else{const sec=EXS().find(s=>s.id===x);if(sec)exView(sec);else hubView()}
  scrollTo(0,0)}
addEventListener('hashchange',()=>{const h=hp();if(h.d!==DID){location.reload();return}H=h;if(DOC)route()});
document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||own(document.activeElement))return;   /* defaultPrevented: the Enter that just checked a gap must not also press "Keyingi" */
  if(VIEW==='lesson'){if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();lessonNext()}else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();lessonPrev()}return}
  if(VIEW==='ex'&&XS&&XS.run){const {items,run}=XS,j=run.list[run.pos],it=items[j];
    if(run.K[j]&&e.key==='Enter'){e.preventDefault();const b=$('#footin button:last-child');if(b&&!b.disabled)b.click()}
    else if(!run.K[j]&&it.t==='mcq'&&/^[a-c1-3]$/i.test(e.key)){const L='abc'['abc123'.indexOf(e.key.toLowerCase())%3];if(it.o.some(o=>o[0]===L)){run.A[it.n]=L;exCheck()}}}});
let tx=null,ty=null;   /* swipe between lesson cards on phones */
document.addEventListener('touchstart',e=>{if(VIEW!=='lesson'||e.touches.length!==1){tx=null;return}tx=e.touches[0].clientX;ty=e.touches[0].clientY},{passive:true});
document.addEventListener('touchend',e=>{if(VIEW!=='lesson'||tx==null)return;const t=e.changedTouches[0],dx=t.clientX-tx,dy=t.clientY-ty;tx=null;
  if(Math.abs(dx)>70&&Math.abs(dy)<45&&!(e.target.closest&&e.target.closest('.cmpw,button,input')))dx<0?lessonNext():lessonPrev()},{passive:true});

let fs=+(ls(ST+'fs')||17);
function setFs(){document.documentElement.style.setProperty('--fs',fs+'px');lset(ST+'fs',fs)}
$('#fsp').onclick=()=>{fs=Math.min(24,fs+1);setFs()};$('#fsm').onclick=()=>{fs=Math.max(14,fs-1);setFs()};setFs();
const PB=$('#pres');   /* big screen: for showing the lesson on a classroom screen */
if(matchMedia('(min-width:900px)').matches)PB.hidden=false;
function pres(on){document.documentElement.classList.toggle('pres',on);PB.setAttribute('aria-pressed',String(on))}
PB.onclick=()=>{const on=!document.documentElement.classList.contains('pres');pres(on);
  try{if(on&&!document.fullscreenElement&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});else if(!on&&document.fullscreenElement)document.exitFullscreen().catch(()=>{})}catch(e){}};
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.documentElement.classList.contains('pres'))pres(false)});

async function boot(){
  if(!DID||!/^[a-z0-9-]+$/.test(DID)){fail('Mavzu topilmadi','Havola noto‘g‘ri. Xaritadan qayta oching.','./#/me');return}
  if(STEP)$('#back').href='./#/me/a/'+encodeURIComponent(STEP.a);
  if(!ls(ST+'k')){fail('Avval kiring','Bu dars faqat EDUNEST o‘quvchilari uchun. Platformaga kiring va xaritadan oching.');return}
  try{DOC=JSON.parse(new TextDecoder().decode(await load(DID)))}
  catch(e){e.message==='net'?fail('Yuklanmadi','Internetni tekshirib, sahifani yangilang.','./#/me'):fail('Qayta kiring','Kirish muddati tugagan. Platformaga qaytadan kiring.');return}
  if(!DOC||!Array.isArray(DOC.sections)){fail('Mavzu topilmadi','Havola noto‘g‘ri. Xaritadan qayta oching.','./#/me');return}
  route();
}
boot();
