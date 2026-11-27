
/* ===================== FEEL: sound, vibration and press feedback (26.11.2026) =====================
   One engine for the Multi-Level pages (index, mashq, grammar). Source: platform/feel.js + platform/feel.css;
   build.py puts both into each page (placeholder FEEL_JS / FEEL_CSS).
   - Sounds are synthesized once, in code (no sound files, nothing downloaded), kept as audio buffers and played
     through one output: instant, the same every time, never piling up (the same sound within 50 ms plays once).
   - Vibration: Android = navigator.vibrate; iPhone (iOS 18+) = the system tick of a hidden switch (only inside a tap).
   - Press: a pressed button or card shrinks by a few pixels and springs back. On touch it waits 70 ms, so scrolling
     a list does not press its cards. Web Animations only: the page's own CSS (transform, transition) stays untouched.
   - Settings on this device: <ns>snd (sounds) and <ns>hap (vibration); both on unless switched off.
   - quiet(): the page says when sounds must wait (an audio track is playing, a mock exam is running); vibration still works.
   - off: no feedback at all on that page (AI Writing / AI Speaking keep exactly their own behaviour).
   ============================================================================================== */
const FEEL=(()=>{
  const TAU=Math.PI*2,nav=navigator,root=document.documentElement;
  let ns='edunest_mlb:',quiet=()=>false,off=false,amb=false,on=false,ctx=null,out=null,idle=0,sw=null,hLast=0,pt='mouse',pr=null,cand=null,tm=0,sx=0,sy=0,prep=false;
  const P={snd:true,hap:true},BUF={},LAST={};
  const rd=k=>{try{return localStorage.getItem(ns+k)}catch(e){return null}};
  const wr=(k,v)=>{try{localStorage.setItem(ns+k,v)}catch(e){}};
  const load=()=>{P.snd=rd('snd')!=='0';P.hap=rd('hap')!=='0'};
  const mm=q=>!!(window.matchMedia&&matchMedia(q).matches);
  const VIB=typeof nav.vibrate==='function';
  const IOS=!VIB&&(/iPhone|iPad|iPod/.test(nav.userAgent)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1));
  const later=window.requestIdleCallback?f=>requestIdleCallback(f,{timeout:500}):f=>setTimeout(f,60);
  const quietly=p=>{if(p&&p.catch)p.catch(()=>{})};
  /* nothing plays or vibrates before the first real tap on this page: the browser blocks it anyway (vibrate logs an error, and a sound
     would wait and then play late, on that first tap), e.g. a mock exam whose time ran out finishing as the page opens */
  const tapped=()=>!nav.userActivation||nav.userActivation.hasBeenActive;

  /* ---------- synthesis (fixed noise seeds: every sound is identical each time) ---------- */
  const rng=s=>()=>((s=(s*1664525+1013904223)>>>0)/2147483648-1);
  // a struck note. parts: [frequency ratio, level, decay factor]; tau: decay time of the main partial (s);
  // att: attack (s); gl: [end ratio, glide time s] bends the pitch
  function note(d,sr,t0,f,vol,tau,parts,att,gl){
    att=att||.003;const i0=Math.round(t0*sr),A=Math.max(1,att*sr);
    if(gl){const n=Math.min(d.length,i0+Math.ceil((att+tau*7*Math.max(...parts.map(p=>p[2])))*sr));   // a bending pitch: phase step by step
      const ph=parts.map(()=>0),lv=parts.map(p=>f*p[0]<sr*.45?p[1]:0),k=parts.map(p=>Math.exp(-1/(tau*p[2]*sr)));
      for(let i=i0;i<n;i++){const j=i-i0,fm=f*Math.pow(gl[0],Math.min(1,j/(gl[1]*sr)));let s=0;
        for(let q=0;q<parts.length;q++){ph[q]+=TAU*fm*parts[q][0]/sr;s+=lv[q]*Math.sin(ph[q]);lv[q]*=k[q]}
        d[i]+=vol*s*(j<A?j/A:1)}return}
    for(const p of parts){if(f*p[0]>=sr*.45)continue;   // a steady pitch: the sine by recurrence (no Math.sin per sample), each partial only as long as it sounds
      const w=TAU*f*p[0]/sr,c=2*Math.cos(w),k=Math.exp(-1/(tau*p[2]*sr)),n=Math.min(d.length,i0+Math.ceil((att+tau*p[2]*7)*sr));let y0=0,y1=Math.sin(w),e=vol*p[1];
      for(let i=i0;i<n;i++){const j=i-i0;d[i]+=e*y1*(j<A?j/A:1);const y2=c*y1-y0;y0=y1;y1=y2;e*=k}}}
  // filtered noise: low-pass lp Hz (gliding to lp2), high-pass hp Hz; attack att, then decay tau
  function hiss(d,sr,t0,vol,att,tau,lp,hp,lp2,seed){
    const i0=Math.round(t0*sr),n=Math.min(d.length,i0+Math.ceil((att+tau*7)*sr)),r=rng(seed),ch=Math.exp(-TAU*hp/sr),A=Math.max(1,att*sr);
    let l=0,x1=0,y=0;
    for(let i=i0;i<n;i++){const j=i-i0,fc=lp2?lp*Math.pow(lp2/lp,Math.min(1,j/((att+tau)*sr))):lp;
      l+=(1-Math.exp(-TAU*fc/sr))*(r()-l);y=ch*(y+l-x1);x1=l;
      d[i]+=vol*y*(j<A?j/A:Math.exp(-(j-A)/(tau*sr)))}}
  // a little room: a few quiet echoes (ms, level)
  function room(d,sr,taps){const o=Float32Array.from(d);taps.forEach(([ms,g])=>{const k=Math.round(ms*sr/1000);for(let i=k;i<d.length;i++)o[i]+=g*d[i-k]});return o}
  // the same loudness for every sound (peak), and a 15 ms fade at the end
  function level(d,sr,peak){let m=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>m)m=a}
    const g=m?peak/m:0,f=Math.min(d.length,Math.round(.015*sr));for(let i=0;i<d.length;i++)d[i]*=g;for(let i=1;i<=f;i++)d[d.length-i]*=(i-1)/f;return d}
  const GLASS=[[1,1,1],[2.76,.16,.32],[5.4,.05,.18]],WOOD=[[1,1,1],[3.93,.12,.22],[9.4,.03,.1]],SOFT=[[1,1,1],[2,.45,.5],[3,.18,.3]];
  const C5=523.25,E5=659.26,G5=783.99,C6=1046.5,E6=1318.51,G6=1567.98,A6=1760;
  // name: [length s, peak, how it is made, room echoes]
  const SND={
    tick:[.05,.2,(d,r)=>{hiss(d,r,0,1,.0003,.0011,7500,1800,0,3);note(d,r,0,1850,.4,.006,[[1,1,1]],.0004)}],                      // a chip, a switch, zoom
    pop:[.15,.26,(d,r)=>note(d,r,0,520,1,.03,[[1,1,1],[2,.12,.5]],.0015,[1.75,.03])],                                            // something switched on
    open:[.6,.28,(d,r)=>{hiss(d,r,0,.25,.07,.05,600,300,5000,11);note(d,r,.045,C6,.75,.13,GLASS);note(d,r,.11,G6,.62,.19,GLASS)},[[67,.12]]],  // a section or sheet opens
    deny:[.42,.3,(d,r)=>{[[0,293.66],[.1,246.94]].forEach(([t,f],i)=>{hiss(d,r,t,.6,.001,.006,1200,90,0,17+i);note(d,r,t,f,1,.075,SOFT,.002,[.96,.06])})}],  // locked / not yet
    wrong:[.36,.26,(d,r)=>{hiss(d,r,0,.5,.001,.006,1100,90,0,19);note(d,r,0,277.18,1,.09,SOFT,.002,[.94,.08])}],                 // a wrong answer
    warn:[.4,.24,(d,r)=>{note(d,r,0,440,1,.07,SOFT,.004);note(d,r,.13,440,.85,.08,SOFT,.004)}],                                   // look again (empty answers)
    correct:[.55,.28,(d,r)=>{note(d,r,0,E6,.8,.11,GLASS,.002);note(d,r,.065,A6,.75,.2,GLASS,.002)},[[61,.1]]],                     // a right answer
    success:[1.1,.32,(d,r)=>{note(d,r,0,C6,.7,.19,GLASS);note(d,r,.075,E6,.62,.19,GLASS);note(d,r,.15,G6,.6,.4,GLASS);note(d,r,.15,G6*2,.05,.1,[[1,1,1]],.002)},[[61,.14],[113,.07]]],  // done well
    complete:[.8,.3,(d,r)=>{note(d,r,0,G5,.8,.2,WOOD);note(d,r,.1,C6,.8,.32,WOOD)},[[67,.1]]],                                    // finished (a calm result)
    celebrate:[2.3,.45,(d,r)=>{[C5,E5,G5,C6,E6,G6].forEach((f,i)=>note(d,r,i*.065,f,.5,.26,GLASS));                              // the whole journey / a gift / 100%
      [C5,E5,G5,C6].forEach(f=>{note(d,r,.4,f,.16,.75,[[1,1,1],[2,.15,.5]],.09);note(d,r,.4,f*1.003,.12,.75,[[1,1,1]],.09)});
      const q=rng(29),sp=[2093,2637.02,3135.96,4186.01];for(let k=0;k<7;k++)note(d,r,.46+k*.11+q()*.03,sp[k%4],.07,.06,[[1,1,1]],.001)},[[73,.24],[127,.16],[181,.1],[241,.06]]]
  };
  // vibration: Android pattern (ms); iPhone [ticks, gap ms] (everything else = 1 tick)
  const VIBP={tap:10,tick:8,pop:8,open:12,deny:[16,60,16,60,16],wrong:[20,60,20],warn:[24,110,24],correct:[10,60,16],success:[12,70,22],complete:[14,90,14],celebrate:[14,80,14,80,40]};
  const IOSP={deny:[3,70],wrong:[2,70],warn:[2,120],correct:[2,80],success:[2,90],complete:[2,120],celebrate:[3,110]};
  const LIGHT={tap:1,tick:1,pop:1};

  /* ---------- sound ---------- */
  function ac(){if(ctx)return ctx;const A=window.AudioContext||window.webkitAudioContext;if(!A)return null;
    try{if(amb&&nav.audioSession)nav.audioSession.type='ambient'}catch(e){}   // iPhone: mixes with the student's music, silent switch = silent
    try{ctx=new A({latencyHint:'interactive'})}catch(e){try{ctx=new A()}catch(e2){return null}}
    out=ctx.createGain();out.gain.value=.9;out.connect(ctx.destination);return ctx}
  function buf(k){if(BUF[k])return BUF[k];const s=SND[k];if(!s||!ctx)return null;const sr=ctx.sampleRate;
    let d=new Float32Array(Math.ceil(s[0]*sr));s[2](d,sr);if(s[3])d=room(d,sr,s[3]);level(d,sr,s[1]);
    const b=ctx.createBuffer(1,d.length,sr);b.getChannelData(0).set(d);return BUF[k]=b}
  function prepAll(){const k=Object.keys(SND).find(x=>!BUF[x]);if(!k||!ctx)return;buf(k);later(prepAll)}
  // called on every tap: phones only start audio inside a tap
  function wake(){if(off||!P.snd)return;const c=ac();if(!c)return;
    if(c.state!=='running'){quietly(c.resume());try{const s=c.createBufferSource();s.buffer=c.createBuffer(1,1,c.sampleRate);s.connect(c.destination);s.start(0)}catch(e){}}
    if(!prep){prep=true;later(prepAll)}}
  function sound(k){if(off||!P.snd||document.hidden||!SND[k]||!tapped())return;try{if(quiet())return}catch(e){}
    const c=ac();if(!c)return;const now=performance.now();if(now-(LAST[k]||0)<50)return;LAST[k]=now;
    if(c.state!=='running')quietly(c.resume());const b=buf(k);if(!b)return;
    try{const s=c.createBufferSource();s.buffer=b;s.connect(out);s.start()}catch(e){}
    clearTimeout(idle);idle=setTimeout(()=>{if(ctx&&ctx.state==='running')quietly(ctx.suspend())},15000)}   // let the phone's audio sleep when nothing plays

  /* ---------- vibration ---------- */
  function tickIOS(){try{if(!sw){sw=document.createElement('label');sw.setAttribute('aria-hidden','true');sw.style.display='none';
      sw.innerHTML='<input type="checkbox" switch tabindex="-1">';sw.addEventListener('click',e=>e.stopPropagation());document.head.appendChild(sw)}
    sw.click()}catch(e){}}
  function haptic(k){if(off||!P.hap||document.hidden||!tapped())return;const now=performance.now(),near=now-hLast<70;
    if(VIB){if(near&&LIGHT[k])return;hLast=now;try{nav.vibrate(VIBP[k]||10)}catch(e){}return}
    if(!IOS)return;const p=IOSP[k]||[1,0];if(near&&p[0]===1)return;
    hLast=now;for(let j=near?1:0;j<p[0];j++)j?setTimeout(tickIOS,j*p[1]):tickIOS()}   // near: the tap's own tick already counts as the first

  /* ---------- press ---------- */
  const PRESS='button,a[href],[role="button"],[role="tab"],[role="switch"],[data-go],[data-press],summary';
  function pressable(t){if(!t||!t.closest||(sw&&sw.contains(t)))return null;let el=t.closest(PRESS);
    if(!el)for(let e=t,i=0;e&&e!==document.body&&i<5;e=e.parentElement,i++)if(typeof e.onclick==='function'&&getComputedStyle(e).cursor==='pointer'){el=e;break}   // a card or the brand with its own click
    if(!el||el.disabled||el.getAttribute('aria-disabled')==='true'||el.closest('[data-nopress]'))return null;return el}
  const MINE=new WeakMap();   // element -> its running press/release animation (so a new press starts from the element's own CSS)
  const run=(el,a)=>{const o=MINE.get(el);if(o&&o!==a)try{o.cancel()}catch(e){}MINE.set(el,a);return a};
  function down(el){if(pr)up();const r=el.getBoundingClientRect();if(!r.width||!el.animate)return;run(el,null);
    const cs=getComputedStyle(el),soft=cs.display==='inline'||mm('(prefers-reduced-motion: reduce)'),t0=cs.transform==='none'?'':cs.transform+' ',s=+(1-Math.min(.05,5/Math.max(r.width,r.height))).toFixed(4);
    try{pr={el,soft,t0,s,a:run(el,soft?el.animate({opacity:[1,.6]},{duration:90,fill:'forwards'}):el.animate({transform:[t0+'scale(1)',t0+'scale('+s+')']},{duration:110,easing:'cubic-bezier(.2,.8,.3,1)',fill:'forwards'}))}}catch(e){pr=null}}
  function up(){const p=pr;if(!p)return;pr=null;
    const back=()=>{if(MINE.get(p.el)!==p.a)return;   // pressed again meanwhile: that press owns the element now
      try{run(p.el,p.soft?p.el.animate({opacity:[.6,1]},{duration:220,easing:'ease-out'}):p.el.animate({transform:[p.t0+'scale('+p.s+')',p.t0+'scale(1)']},{duration:420,easing:'cubic-bezier(.34,1.56,.64,1)'}))}catch(e){}};
    if(p.a.playState==='running'&&p.a.finished)p.a.finished.then(back,()=>{});else back()}   // a quick tap still shows the whole press
  function cancel(){clearTimeout(tm);cand=null;up()}

  function init(o){o=o||{};if(o.ns)ns=o.ns;if(o.quiet)quiet=o.quiet;amb=!!o.ambient;load();if(o.off)setOff(true);
    if(on)return;on=true;if(!off)root.classList.add('fx');
    const opt={capture:true,passive:true};
    addEventListener('pointerdown',e=>{pt=e.pointerType||'mouse';if(off||e.button>0)return;if(pt==='mouse')wake();
      const el=pressable(e.target);clearTimeout(tm);cand=el;if(!el)return;sx=e.clientX;sy=e.clientY;
      if(pt==='mouse')down(el);else tm=setTimeout(()=>{if(cand===el)down(el)},70)},opt);
    addEventListener('pointermove',e=>{if(cand&&pt!=='mouse'&&(Math.abs(e.clientX-sx)>10||Math.abs(e.clientY-sy)>10))cancel()},opt);
    addEventListener('pointerup',e=>{clearTimeout(tm);if(off)return;if(e.pointerType!=='mouse')wake();const el=cand;cand=null;if(!el)return;
      if(!pr&&e.pointerType!=='mouse')down(el);up()},opt);
    addEventListener('pointercancel',cancel,opt);
    addEventListener('scroll',()=>{if(cand&&pt!=='mouse')cancel()},opt);
    addEventListener('click',e=>{if(off||!e.isTrusted||e.detail===0||pt==='mouse')return;if(pressable(e.target))haptic('tap')},true);   // touch: a light tick on every tap
    addEventListener('change',e=>{const t=e.target;if(!off&&e.isTrusted&&t&&t.matches&&t.matches('input[type="checkbox"],input[type="radio"],select'))haptic('tick')},true);
    addEventListener('keydown',e=>{if(off||e.repeat||(e.key!=='Enter'&&e.key!==' '))return;wake();const el=pressable(e.target);if(el&&el===document.activeElement)down(el)},true);
    addEventListener('keyup',e=>{if(e.key==='Enter'||e.key===' ')up()},true);
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&ctx&&ctx.state==='running')quietly(ctx.suspend())});
    addEventListener('storage',e=>{if(e.key===ns+'snd'||e.key===ns+'hap')load()})}
  function setOff(v){off=!!v;root.classList.toggle('fx',on&&!off);if(off){cancel();if(ctx&&ctx.state==='running')quietly(ctx.suspend())}}

  return {init,sound,haptic,
    play(k){sound(k);haptic(k)},
    get:k=>P[k],
    set(k,v){P[k]=!!v;wr(k,v?'1':'0');if(k==='snd'&&v)wake()},
    canHaptic:()=>(VIB&&nav.maxTouchPoints>0)||IOS,   // phones and tablets only
    off:setOff,
    _render:k=>{if(!ac())return null;return buf(k)},names:()=>Object.keys(SND)};
})();

const ST='edunest_mlb:';
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lset=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const H=Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const own=e=>/^(INPUT|TEXTAREA)$/.test((e&&e.tagName)||'');
document.addEventListener('contextmenu',e=>{if(!own(e.target))e.preventDefault()});
document.addEventListener('copy',e=>{if(!own(document.activeElement))e.preventDefault()});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&/^[spu]$/i.test(e.key))e.preventDefault()});

let SESSION=null;try{SESSION=JSON.parse(ls(ST+'session')||'null')}catch(e){}
const UID=SESSION&&SESSION.id||'anon';
function who(){let p=null;try{p=JSON.parse(ls(ST+'p:'+UID)||'null')}catch(e){}const n=p&&p.student?p.student.name:'';return (n||'EDUNEST')+(p&&p.student&&p.student.id?' · '+p.student.id:'')}
function watermark(){const t=esc(who());const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='340' height='210'><text x='10' y='120' transform='rotate(-22 170 105)' font-family='Arial' font-size='15' font-weight='700' fill='rgba(20,27,45,0.055)'>${t}</text></svg>`;
  document.documentElement.style.setProperty('--wm',`url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`)}

function fail(h,p,link){$('#main').innerHTML=`<div class="msg"><h2>${esc(h)}</h2><p>${esc(p)}</p><a href="${link||'./#/login'}">${link?'Xaritaga qaytish':'Platformaga kirish'}</a></div>`;$('#foot').hidden=true}
async function sha8(s){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));return [...h.slice(0,4)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function decrypt(buf){
  const K=ls(ST+'k');if(!K)throw new Error('nokey');
  if(String.fromCharCode(...buf.slice(0,4))!=='EDN1')throw new Error('bad');
  const salt=buf.slice(4,20),sk=ST+'dk:'+(await sha8(K))+':'+btoa(String.fromCharCode(...salt));let key=null;
  try{const c=sessionStorage.getItem(sk);if(c)key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(c),x=>x.charCodeAt(0)),'AES-GCM',false,['decrypt'])}catch(e){}
  if(!key){  /* the 150 000-round key derivation is slow on phones: do it once per tab session, then reuse */
    const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(K),'PBKDF2',false,['deriveKey']);
    const k2=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,['decrypt']);
    try{sessionStorage.setItem(sk,btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw',k2)))))}catch(e){}
    key=k2}
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(20,32)},key,buf.slice(32)));
}
async function load(name){const r=await fetch(name+'.bin',{cache:'no-cache'});if(!r.ok)throw new Error('net');return decrypt(new Uint8Array(await r.arrayBuffer()))}
/* new materials are plain JSON in d/ (fast: no decryption); older ones stay encrypted .bin */
const PLAIN=/^(lm|nm|ml|lp3|rm\d|rn\d|r1[pb]|dc)/;
async function loadDoc(id){
  if(PLAIN.test(id)){try{const r=await fetch('d/'+id+'.json?v=1');if(r.ok)return await r.json()}catch(e){throw new Error('net')}}
  return JSON.parse(new TextDecoder().decode(await load(id)))}

/* ---------- answer checking ---------- */
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’‘`]/g,"'").replace(/[£$€]/g,'').replace(/[.,;:!?]+$/,'').replace(/\bcan't\b/g,'cannot').replace(/won't\b/g,'will not').replace(/n't\b/g,' not').replace(/'ve\b/g,' have').replace(/'re\b/g,' are').replace(/'m\b/g,' am').replace(/'ll\b/g,' will').replace(/\s+/g,' ').trim();
const isOk=(v,acc)=>!!norm(v)&&acc.some(a=>norm(a)===norm(v));

/* markers: \x01..\x02 bold, \x03..\x04 italic, \x05..\x06 highlight, \x0e..\x0f red text, \x10..\x11 strikethrough */
const rich=x=>esc(x).replace(/\x01/g,'<b>').replace(/\x02/g,'</b>').replace(/\x03/g,'<i>').replace(/\x04/g,'</i>').replace(/\x05/g,'<mark class="hl">').replace(/\x06/g,'</mark>').replace(/\x0e/g,'<span class="rd">').replace(/\x0f/g,'</span>').replace(/\x10/g,'<s>').replace(/\x11/g,'</s>');
let DOC=null,SEC=null,ANS={},DONE=null,armed=false,audioUrl=null,EX=null,WR={};
const OPENED=Date.now();let T0=OPENED;  /* T0: start of this attempt (time spent goes to the teacher) */
function toast(m){let d=document.getElementById('mtoast');if(!d){d=document.createElement('div');d.id='mtoast';d.setAttribute('role','status');d.style.cssText='position:fixed;left:50%;bottom:96px;transform:translateX(-50%);max-width:min(92vw,460px);background:#141B2D;color:#fff;padding:12px 18px;border-radius:14px;font-weight:600;font-size:15px;z-index:9999;box-shadow:0 12px 30px rgba(0,0,0,.3);text-align:center;transition:opacity .2s';document.body.appendChild(d)}d.textContent=m;d.style.opacity=1;clearTimeout(d._t);d._t=setTimeout(()=>d.style.opacity=0,3200)}
const key=()=>ST+'mashq:'+UID+':'+H.d+':'+(EX?'exam':SEC.id);
function save(){if(EX){lset(key(),JSON.stringify({a:ANS,t0:EX.t0,part:EX.part,r:EX.r}));return}lset(key(),JSON.stringify({a:ANS,r:DONE,w:WR}))}
function restore(){let s=null;try{s=JSON.parse(ls(key())||'null')}catch(e){}ANS=(s&&s.a)||{};DONE=(s&&s.r)||null;WR=(s&&s.w)||{}}

function gapHTML(n){return `<span class="gapw" data-q="${n}"><span class="num">${n}</span><input class="gap" data-n="${n}" aria-label="Savol ${n}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"></span>`}
const fillGaps=x=>rich(x).replace(/\{\{(\d+)(?::([^}]+))?\}\}/g,(_,n,o)=>o?`<span class="gapw" data-q="${n}"><span class="num">${n}</span><span class="pick in"><select data-n="${n}" aria-label="Savol ${n}"><option value="">…</option>${o.split('|').map(v=>`<option>${v}</option>`).join('')}</select></span></span>`:gapHTML(n));
function sizeGaps(){document.querySelectorAll('input.gap').forEach(i=>{if(SEC.gapw){i.style.width=SEC.gapw+'em';return}const a=(SEC.ans[i.dataset.n]||[''])[0];const L=Math.max(5,Math.min(30,a.length+2));i.style.width=L*.62+'em'})}
function pickHTML(n){const o=SEC.sel[n];if(!o)return '';const side=(SEC.side&&SEC.side.items)||[];
  return `<span class="pick"><select data-n="${n}" aria-label="Savol ${n} uchun javob"><option value="">Tanlang</option>${o.map(L=>{const t=(side.find(s=>s[0]===L)||[])[1]||'';return `<option value="${L}">${L}${t?' — '+esc(t.length>58?t.slice(0,56)+'…':t):''}</option>`}).join('')}</select></span>`}

function blockHTML(b){
  if(b.t==='h')return `<h2>${rich(b.x)}</h2>`;
  if(b.t==='p')return `<p>${fillGaps(b.x)}</p>`;
  if(b.t==='rp')return `<p class="rp">${rich(b.x).replace(/\n/g,'<br>')}</p>`;
  if(b.t==='row'){const g=b.x.match(/\{\{(\d+)/g)||[];if(g.length===1){const n=g[0].slice(2);return `<div class="row one" data-q="${n}"><span class="num">${n}</span><span>${fillGaps(b.x).replace(/<span class="num">\d+<\/span>/,'')}</span></div>`}return `<div class="row">${fillGaps(b.x)}</div>`}
  if(b.t==='sub')return `<h3 class="sub">${rich(b.x)}</h3>`;
  if(b.t==='ex')return `<div class="row exm"><b>Namuna</b>${esc(b.x)}</div>`;
  if(b.t==='chips')return `<div class="chips">${b.x.map(w=>w[0]==='~'?`<s>${esc(w.slice(1))}</s>`:`<span>${esc(w)}</span>`).join('')}</div>`;
  if(b.t==='img')return `<figure class="mapfig"><img src="${esc(b.src)}" alt="${esc(b.alt||'')}" loading="lazy" onclick="this.parentNode.classList.toggle('zoom')"><figcaption>Kattalashtirish uchun bosing</figcaption></figure>`;
  if(b.t==='box')return `<div class="box" data-q="${b.n}"><div class="boxh"><span class="num">${b.n}</span><strong>${esc(b.title)}</strong>${pickHTML(b.n)}</div><div>${esc(b.x)}</div><div class="nt" data-nt="${b.n}" hidden></div></div>`;
  return '';
}
function qHTML(q){
  if(q.t==='note')return `<div class="note">${esc(q.x)}</div>`;
  if(q.t==='gap')return `<div class="q" data-q="${q.n}"><div class="qh"><span class="num">${q.n}</span><div>${fillGaps(q.q).replace(gapHTML(q.n),`<span class="gapw" data-q="${q.n}"><input class="gap" data-n="${q.n}" aria-label="Savol ${q.n}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></span>`)}</div></div></div>`;
  const opts=q.t==='tfn'?[['TRUE','True'],['FALSE','False'],['NO INFORMATION','No info']]:q.o;
  return `<div class="q" data-q="${q.n}"><div class="qh"><span class="num">${q.n}</span><div>${esc(q.q)}</div></div><div class="${q.t==='tfn'?'tfn':'opts'}">${opts.map(o=>`<button type="button" class="opt" data-n="${q.n}" data-v="${esc(o[0])}" aria-pressed="false">${q.t==='tfn'?'':`<i>${o[0]}</i>`}<span>${esc(o[1])}</span></button>`).join('')}</div></div>`;
}

function nums(){return Object.keys(SEC.ans).map(Number).sort((a,b)=>a-b)}
function answered(){return nums().filter(n=>norm(ANS[n])).length}

function render(){
  if(SEC.kind==='study'){renderStudy();return}
  if(SEC.kind==='write'){FEEL.off(true);renderWrite();return}   /* writing tasks hold the AI Writing checker: left exactly as before */
  if(SEC.kind==='note'){renderNote();return}
  const s=SEC,split=s.layout==='split';
  $('#ttl').textContent=DOC.short+' · '+s.label;$('#sub').textContent=s.title;document.title='EDUNEST · '+DOC.short+' · '+s.label;
  let left='',right='';
  const paper=!s.blocks.length?'':`<div class="paper">${s.blocks.map(blockHTML).join('')}${s.kind==='listen'?'<div id="scr"></div>':''}</div>`;
  if(s.side){const side=`<div class="paper side"><h3>${esc(s.side.title)}</h3><ol>${s.side.items.map(i=>`<li data-l="${i[0]}"><i>${i[0]}</i><span>${i[2]?`<b>${esc(i[1])}</b>${esc(i[2])}`:esc(i[1])}</span></li>`).join('')}</ol></div>`;if(s.sideAfter){left=paper;right=side}else{left=side;right=paper}}
  /* 27.11.2026: a listening section with questions only (Part 1, Part 5) keeps its script in a card under the questions (shown after checking) */
  else if(s.qs.length&&!paper){left=`<div class="qs">${s.qs.map(qHTML).join('')}</div>${s.kind==='listen'&&(s.script||[]).length?'<div class="paper scrp" hidden><div id="scr"></div></div>':''}`}
  else if(s.qs.length){left=paper;right=`<div class="qs">${s.qs.map(qHTML).join('')}</div>`}
  else{left=paper}
  $('#main').innerHTML=`<div id="res"></div>${s.kind==='listen'?'<div id="pl"></div>':''}<div class="instr"><b>${esc(s.label)}</b>${esc(s.instr)}</div>
    <div class="grid ${split&&right?'split':''}"><div class="col" id="cA">${left}</div>${right?`<div class="col" id="cB">${right}</div>`:''}</div><div id="aft"></div>`;
  watermark();sizeGaps();
  // restore answers
  document.querySelectorAll('.gap').forEach(i=>{i.value=ANS[i.dataset.n]||'';i.addEventListener('input',()=>{ANS[i.dataset.n]=i.value;armed=false;save();foot()});
    i.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const all=[...document.querySelectorAll('.gap')];const nx=all[all.indexOf(i)+1];nx?nx.focus():i.blur()}})});
  document.querySelectorAll('select[data-n]').forEach(sl=>{sl.value=ANS[sl.dataset.n]||'';sl.classList.toggle('empty',!sl.value);sl.addEventListener('change',()=>{ANS[sl.dataset.n]=sl.value;sl.classList.toggle('empty',!sl.value);armed=false;save();used();foot()})});
  document.querySelectorAll('.opt').forEach(b=>{b.setAttribute('aria-pressed',ANS[b.dataset.n]===b.dataset.v);b.addEventListener('click',()=>{if(DONE)return;FEEL.play('tick');ANS[b.dataset.n]=b.dataset.v;armed=false;save();
    document.querySelectorAll(`.opt[data-n="${b.dataset.n}"]`).forEach(x=>x.setAttribute('aria-pressed',x===b));foot()})});
  used();
  if(s.kind==='listen')player();
  // mobile jump between text and questions
  const jb=$('#jump');const jl=s.qs.length?['Savollar ↓','Matn ↑']:s.sideAfter?['Matnlar ↓','Savollar ↑']:['Matn ↓','Sarlavhalar ↑'];
  if(right&&(s.qs.length||s.side)){jb.hidden=false;const upd=()=>{const B=$('#cB');if(!B)return;const below=B.getBoundingClientRect().top>innerHeight*.6;jb.textContent=below?jl[0]:jl[1];jb.onclick=()=>(below?B:$('#cA')).scrollIntoView({behavior:'smooth',block:'start'})};addEventListener('scroll',upd,{passive:true});upd()}else jb.hidden=true;
  if(EX)examChrome();
  if(DONE)showResult(false);
  foot();
}
function used(){if(!SEC.side)return;const v=new Set(Object.values(ANS));document.querySelectorAll('.side li').forEach(li=>li.classList.toggle('used',v.has(li.dataset.l)))}

function goDone(){const canDone=H.a&&H.s!=null;location.href=canDone?'./#/me/a/'+encodeURIComponent(H.a)+'/done/'+(+H.s):'./#/me'}
function foot(){
  if(EX){examFoot();return}
  const f=$('#footin');$('#foot').hidden=false;
  if(SEC.kind==='study'||SEC.kind==='write'||SEC.kind==='note'){f.innerHTML=`<button id="dn">${H.a&&H.s!=null?'Bajardim':'Xaritaga qaytish'}</button>`;
    $('#dn').onclick=()=>{if(H.a&&H.s!=null){
      if(SEC.kind==='write'&&!Object.values(WR.t||{}).some(x=>typeof x==='string'&&x.trim().split(/\s+/).length>=30)){toast('Avval kamida bitta javobni yozing (30 so‘zdan ko‘p). Shundan keyin “Bajardim” ishlaydi.');return}
      if(SEC.kind==='study'||SEC.kind==='note'){if(Date.now()-OPENED<60000){toast(SEC.kind==='note'?'Avval materialni o‘qib chiqing. Kamida 1 daqiqa ishlang.':`Avval ${SEC.unit==='so‘z'?'so‘zlarni':'iboralarni'} o‘qib chiqing. Kamida 1 daqiqa ishlang.`);return}lset(key(),JSON.stringify({a:ANS,r:DONE,w:WR,v:Date.now()}))}}
      goDone()};return}
  const total=nums().length,a=answered();
  if(!DONE){
    f.innerHTML=`<button id="chk" class="${armed?'warn':''}">${armed?`${total-a} ta savol bo‘sh — baribir tekshirish`:'Javoblarni tekshirish'}<span class="cnt">${a} / ${total} javob yozildi</span></button>`;
    $('#chk').onclick=()=>{if(a<total&&!armed){armed=true;FEEL.play('warn');foot();return}check()};
  }else{
    const canDone=H.a&&H.s!=null;
    f.innerHTML=`<button class="alt" id="again">Qayta ishlash</button>${canDone?`<button id="dn">Bajardim</button>`:`<button id="dn">Xaritaga qaytish</button>`}`;
    $('#again').onclick=()=>{DONE=null;ANS={};armed=false;T0=Date.now();save();render();scrollTo(0,0)};
    $('#dn').onclick=()=>{location.href=canDone?'./#/me/a/'+encodeURIComponent(H.a)+'/done/'+(+H.s):'./#/me'};
  }
}

function check(){
  const res={};nums().forEach(n=>res[n]=isOk(ANS[n],SEC.ans[n]));
  DONE={ok:Object.values(res).filter(Boolean).length,of:nums().length,res};save();showResult(true);foot();
  const pc=DONE.of?Math.round(DONE.ok/DONE.of*100):0;FEEL.play(pc===100?'celebrate':pc>=67?'success':'complete');   /* same rule as the message in showResult(): Mukammal / Yaxshi natija / the rest */
  if(DONE.of)sendRes(Object.assign(resBase(),{kind:'ex',sec:String(SEC.id),title:(DOC.short||DOC.title||'')+' · '+(SEC.label||'')+(SEC.title?' · '+SEC.title:''),
    ok:DONE.ok,of:DONE.of,secs:Math.round((Date.now()-T0)/1000),det:nums().map(n=>[String(n),ANS[n]||'',res[n]?1:0,SEC.ans[n][0]])}));
}
function showResult(scroll){
  const {ok,of,res}=DONE;const pc=Math.round(ok/of*100);
  const msg=pc===100?'Mukammal! Hammasi to‘g‘ri.':pc>=67?'Yaxshi natija. Xatolarni ko‘rib chiqing.':pc>=34?'Yomon emas. Qizil belgilangan joylarni qayta o‘qing.':'Matnga qaytib, javob joylarini topishga harakat qiling.';
  $('#res').innerHTML=`<div class="score"><div class="big" style="--p:${pc}"><span>${ok}/${of}</span></div><p><b>${msg}</b>Yashil — to‘g‘ri, qizil — xato. To‘g‘ri javob yonida ko‘rsatilgan.</p></div>`;
  document.querySelectorAll('input.gap,select[data-n]').forEach(e=>e.disabled=true);
  nums().forEach(n=>{
    const good=res[n];const acc=SEC.ans[n];   /* every accepted option turns green (26.11.2026: RT6 Q29 accepts B and C) */
    document.querySelectorAll(`[data-q="${n}"]`).forEach(el=>{el.classList.remove('ok','bad');el.classList.add(good?'ok':'bad')});
    const btns=document.querySelectorAll(`.opt[data-n="${n}"]`);
    if(btns.length){btns.forEach(b=>{b.disabled=true;if(acc.includes(b.dataset.v))b.classList.add('right');else if(b.dataset.v===ANS[n])b.classList.add('wrong')})}
    else if(!good){const host=document.querySelector(`.gapw[data-q="${n}"]`)||document.querySelector(`.box[data-q="${n}"] .boxh`);if(host&&!host.querySelector('.fix'))host.insertAdjacentHTML('beforeend',`<span class="fix">✓ ${esc(SEC.ans[n].join(' / '))}</span>`)}
  });
  if(SEC.kind==='listen'&&$('#scr')){const sp=$('#scr').closest('.scrp');if(sp)sp.hidden=false;$('#scr').innerHTML=`<button class="reveal" id="rv">Skriptni ochish — javoblar sariq rangda</button>`;$('#rv').onclick=script}
  if(SEC.notes){Object.keys(SEC.notes).forEach(n=>{if(document.querySelector(`[data-nt="${n}"]`))return;
      const g=document.querySelector(`.gapw[data-q="${n}"]`);const host=document.querySelector(`.q[data-q="${n}"],.row[data-q="${n}"]`)||(g&&g.closest('p,.row,.q'));
      if(host)host.insertAdjacentHTML('afterend',`<details class="nt nx" data-nt="${n}"><summary></summary><div></div></details>`)});
    document.querySelectorAll('[data-nt]').forEach(el=>{const n=el.dataset.nt;if(!SEC.notes[n])return;const h=`<span class="k">${n} · Javob: ${esc(SEC.ans[n][0])}</span>`,b=rich(SEC.notes[n]).replace(/\n/g,'<br>');
      if(el.tagName==='DETAILS'){el.querySelector('summary').innerHTML=h+'<em>Tahlil</em>';el.querySelector('div').innerHTML=b}else el.innerHTML=h+b;el.hidden=false})}
  if(SEC.after&&$('#aft')&&!$('#aft').innerHTML){$('#aft').innerHTML=`<button class="reveal" id="rva">${esc(SEC.afterLabel||'Tarjimani ochish')}</button>`;$('#rva').onclick=()=>{$('#aft').innerHTML=`<div class="paper after">${SEC.after.map(afterHTML).join('')}</div>`;watermark()}}
  if(scroll)scrollTo({top:0,behavior:'smooth'});
}
function afterHTML(b){
  if(b.t==='ah')return `<h3>${esc(b.x)}</h3>`;
  if(b.t==='at')return `<h4>${esc(b.x)}</h4>`;
  if(b.t==='ap')return `<p>${rich(b.x)}</p>`;
  if(b.t==='atr')return `<ol class="trl">${b.x.map(r=>`<li><i>${esc(r[0])}</i><span><b>${esc(r[1])}</b><em>${esc(r[2])}</em></span></li>`).join('')}</ol>`;
  if(b.t==='av')return `<div class="vl">${b.x.map(r=>`<div><b>${esc(r[0])}</b><span>${esc(r[1])}</span></div>`).join('')}</div>`;
  return '';
}

/* ---------- vocabulary: study cards ---------- */
function renderStudy(){
  const s=SEC;$('#ttl').textContent=DOC.short+' · '+s.label;$('#sub').textContent=s.title;document.title='EDUNEST · '+s.label+' · '+s.title;$('#jump').hidden=true;
  const card=it=>`<article class="paper vc"><header><span class="num">${it.n}</span><h3>${esc(it.w)}</h3>${it.ty?`<em>${esc(it.ty)}</em>`:''}</header><div class="vb">
    <p class="tr">${esc(it.tr)}</p>${it.df?`<p class="df"><b>Ta’rif:</b> ${esc(it.df)}</p>`:''}${it.sy?`<p class="df sy"><b>Sinonimlar:</b> ${esc(it.sy)}</p>`:''}
    ${it.ex&&it.ex.length?`<ol>${it.ex.map(e=>`<li>${rich(e[0])}<span class="uz">${esc(e[1])}</span></li>`).join('')}</ol>`:''}
    ${it.sp?`<div class="sp"><span class="spk">${esc(it.sp[0])}</span><p class="sq">Q: ${esc(it.sp[1])}</p><p>A: ${rich(it.sp[2])}</p><span class="uz">${esc(it.sp[3])}</span></div>`:''}</div></article>`;
  const cnt=s.items.length+' ta '+(s.unit||'ibora');
  $('#main').innerHTML=`<div class="instr"><b>${esc(s.label)} · ${esc(s.title)}</b>${esc(s.instr)}</div>
    <div class="vtools"><button id="hz" aria-pressed="false">Tarjimani yashirish</button><span id="hzt">${esc(cnt)}</span></div>
    <div class="vgrid" id="vg">${s.items.map(card).join('')}</div>`;
  watermark();
  $('#hz').onclick=()=>{const on=$('#vg').classList.toggle('hideuz');$('#hz').setAttribute('aria-pressed',on);$('#hz').textContent=on?'Tarjimani ko‘rsatish':'Tarjimani yashirish';$('#hzt').textContent=on?'O‘zingizni sinang: tarjimani ko‘rish uchun ustiga bosing':cnt;document.querySelectorAll('.uz.show,.tr.show').forEach(e=>e.classList.remove('show'))};
  $('#vg').onclick=e=>{const t=e.target.closest('.uz,.tr');if(t&&$('#vg').classList.contains('hideuz'))t.classList.toggle('show')};
  foot();
}

/* ---------- reading material: rule notes, templates, samples (text only, no questions) ---------- */
function renderNote(){
  const s=SEC;$('#ttl').textContent=DOC.short+' · '+s.label;$('#sub').textContent=s.title;document.title='EDUNEST · '+DOC.short+' · '+s.title;$('#jump').hidden=true;
  $('#main').innerHTML=`<div class="wwrap">${s.instr?`<div class="instr"><b>${esc(s.label)}</b>${esc(s.instr)}</div>`:''}<div class="paper nd">${s.blocks.map(blockHTML).join('')}</div></div>`;
  watermark();foot();
}

/* ---------- writing: task, own attempt, model answer ---------- */
const wcount=t=>(String(t||'').trim().match(/\S+/g)||[]).length;
function renderWrite(){
  const s=SEC;$('#ttl').textContent=DOC.short+' · '+s.label;$('#sub').textContent=s.title;document.title='EDUNEST · '+DOC.short+' · '+s.title;$('#jump').hidden=true;
  const paras=a=>a.map(p=>`<p>${esc(p)}</p>`).join('');
  const head=(s.sit||s.mail)?`<div class="paper"><h2>${esc(s.title)}</h2>${s.sit?`<p class="wsit">${esc(s.sit)}</p>`:''}${s.mail?`<div class="mail">${paras(s.mail)}</div>`:''}</div>`:'';
  const ai=aiEnabled();
  const task=(t,i)=>`<div class="paper wt" data-t="${i}"><div class="wh"><span class="tag">${esc(t.tag)}</span><div class="wq">${esc(t.q)}</div></div>
    <textarea data-w="${i}" placeholder="Javobingizni shu yerga yozib ko‘ring…" aria-label="${esc(t.tag)} uchun javobingiz" autocapitalize="sentences" spellcheck="false"></textarea>
    <div class="wbar"><span class="wc" data-c="${i}">0 so‘z</span><span>Maqsad: ${t.lo===t.hi?t.lo:t.lo+'–'+t.hi} so‘z</span></div>
    ${ai?`<button class="aib" type="button" data-ai="${i}">${AI_ICON} AI bilan tekshirish</button><div data-ar="${i}"></div>`:''}
    ${t.m?`<button class="reveal" data-m="${i}">Namuna javobni ko‘rish</button><div data-mb="${i}"></div>`:''}</div>`;
  $('#main').innerHTML=`<div class="wwrap"><div class="instr"><b>${esc(s.label)}</b>${esc(s.instr)}</div>${head}${s.tasks.map(task).join('')}<p class="whint">${ai?'Yozganingiz shu qurilmada saqlanadi. «AI bilan tekshirish»ni bossangiz, matn tekshiruvga yuboriladi (ismingiz emas) va natijani ustozingiz ham ko‘radi.':'Yozganingiz faqat shu qurilmada saqlanadi, ustozga yuborilmaydi.'}</p></div>`;
  watermark();
  const model=i=>{const t=s.tasks[i];document.querySelector(`[data-mb="${i}"]`).innerHTML=`<div class="model"><div class="mh"><span>${esc(t.mk)}</span><span>${t.mw} so‘z</span></div>${paras(t.m)}</div>`;const b=document.querySelector(`[data-m="${i}"]`);if(b)b.remove()};
  const upd=i=>{const t=s.tasks[i],n=wcount((WR.t||{})[i]);const c=document.querySelector(`[data-c="${i}"]`);c.textContent=n+' so‘z';c.classList.toggle('in',n>=t.lo&&n<=t.hi)};
  document.querySelectorAll('textarea[data-w]').forEach(a=>{const i=a.dataset.w;a.value=(WR.t||{})[i]||'';upd(i);a.addEventListener('input',()=>{WR.t=WR.t||{};WR.t[i]=a.value;save();upd(i)})});
  document.querySelectorAll('[data-m]').forEach(b=>{const i=b.dataset.m;b.onclick=()=>{WR.m=WR.m||{};WR.m[i]=1;save();model(i)};if((WR.m||{})[i])model(i)});
  // AI check per task: type from the target length (1.1 ≈ 50 words, 1.2 = 120–150, Part 2 = 180–200)
  const aiTask=i=>{const t=s.tasks[i];const type=t.lo<100?'1.1':t.lo<170?'1.2':'2';
    return {type,task:[s.sit,(s.mail||[]).join('\n'),type==='2'?s.instr:'',t.q].filter(Boolean).join('\n\n')}};
  const again=b=>{b.classList.add('again');b.innerHTML=AI_ICON+' Tuzatib, qayta tekshirish'};
  const aOpts=i=>({onRewrite:()=>{const a=document.querySelector(`textarea[data-w="${i}"]`);a.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>a.focus({preventScroll:true}),350)},
    onAnother:()=>{location.hash='#d='+H.d+(H.a?'&a='+encodeURIComponent(H.a):'')},anotherLabel:'Boshqa savol'});
  document.querySelectorAll('[data-ai]').forEach(b=>{const i=b.dataset.ai,host=document.querySelector(`[data-ar="${i}"]`);
    const prev=(WR.ai||{})[i];if(prev&&prev.r){aiResult(host,prev.r,prev.x,aOpts(i));again(b)}
    b.onclick=async()=>{const text=((WR.t||{})[i]||'').trim();
      if(wcount(text)<10){host.innerHTML=`<div class="aierr">${AI_ERR.short}</div>`;return}
      const q=aiTask(i);b.disabled=true;const stop=aiLoading(host);
      const j=await aiCheck(q.type,q.task,text,H.d+':'+SEC.id+':'+i);stop();b.disabled=false;
      if(!j||!j.ok){host.innerHTML=`<div class="aierr">${esc(AI_ERR[j&&j.error]||AI_ERR.fail)}</div>`;return}
      WR.ai=WR.ai||{};WR.ai[i]={r:j.r,x:text,at:Date.now()};save();aiResult(host,j.r,text,aOpts(i));again(b);
      host.firstElementChild.scrollIntoView({behavior:'smooth',block:'start'})}});
  foot();
}

/* ---------- AI writing checker (Google Gemini through the EDUNEST script) ---------- */
const CLOUD_URL="https://tuffyskazbkbezsghgtk.supabase.co/functions/v1/api";
/* every checked exercise / mock goes to the teacher (25.11.2026): queued in this browser, re-sent until the server has it (the server stores each cid once) */
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
const resBase=()=>({doc:H.d,aid:H.a||'',step:H.s!=null&&H.s!==''&&isFinite(+H.s)?+H.s:null});
addEventListener('online',rqFlush);setTimeout(rqFlush,1500);
const AI_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
function aiEnabled(){let p=null;try{p=JSON.parse(ls(ST+'p:'+UID)||'null')}catch(e){}return !!(p&&p.ai)}
const AI_T={'1.1':{n:'Task 1.1 · norasmiy xat',lo:40,hi:60,max:15,lv:'B1'},'1.2':{n:'Task 1.2 · rasmiy xat',lo:120,hi:150,max:20,lv:'B2'},'2':{n:'Part 2 · esse',lo:180,hi:200,max:40,lv:'C1'}};
// [key, full name, short name for the chart]; older results have only the first four
const AI_C=[['task','Topshiriqni bajarish','Topshiriq'],['grammar','Grammatika','Grammatika'],['vocabulary','Lug‘at boyligi','Lug‘at'],['organisation','Izchillik va bog‘lanish','Bog‘lanish'],['mechanics','Imlo va tinish belgilari','Imlo']];
const aiCrit=r=>AI_C.filter(c=>r&&r.scores&&c[0] in r.scores);
const aiPts=r=>r&&r.max?`${r.points}/${r.max}`:`${r&&r.score75||0}/75`;
const AI_MT={grammar:'Grammatika',vocabulary:'Lug‘at',spelling:'Imlo',punctuation:'Tinish belgisi',style:'Uslub',register:'Rasmiylik',organisation:'Tuzilish'};
const AI_ERR={off:'AI tekshiruvi hozircha yoqilmagan. Ustozga murojaat qiling.',busy:'AI hozir juda band (bepul limit tugadi). 1–2 daqiqadan keyin qayta urinib ko‘ring.',
  limit:'Bugungi tekshiruvlar soni tugadi. Ertaga yana urinib ko‘ring.',short:'Kamida 10 ta so‘z yozing — AI juda qisqa matnni baholay olmaydi.',
  long:'Matn juda uzun (600 so‘zdan ko‘p). Faqat bitta topshiriq javobini yuboring.',auth:'Kirish muddati tugagan. Platformaga qaytadan kiring.',
  type:'Topshiriq turini tanlang.',net:'Internet bilan muammo. Ulanishni tekshirib, qayta urinib ko‘ring.',fail:'Tekshirib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.'};
async function aiCheck(type,task,text,src){
  if(!SESSION||!SESSION.t)return {ok:false,error:'auth'};
  const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),150000);
  try{const r=await fetch(CLOUD_URL,{method:'POST',body:JSON.stringify({action:'aicheck',id:SESSION.id,t:SESSION.t,type,task,text,src}),signal:ctl.signal});return await r.json()}
  catch(e){return {ok:false,error:'net'}}finally{clearTimeout(tm)}
}
const AI_STEPS=['Matn o‘qilmoqda…','Xatolar qidirilmoqda…','5 mezon bo‘yicha baholanmoqda…','Yaxshilangan variant yozilmoqda…','Deyarli tayyor…'];
function aiLoading(host){let i=0;host.innerHTML=`<div class="aiload" role="status" aria-live="polite"><div class="dots"><i></i><i></i><i></i></div><b>${AI_STEPS[0]}</b><span>Odatda 15–40 soniya. Sahifani yopmang.</span></div>`;
  const b=host.querySelector('b');const iv=setInterval(()=>{i=Math.min(AI_STEPS.length-1,i+1);b.textContent=AI_STEPS[i]},7000);return ()=>clearInterval(iv)}
const lvShort=l=>l==='B1 dan past'?'B1−':l;
const lvColor=l=>l==='C1'?'#2ECC71':l==='B2'?'#4EA8FF':l==='B1'?'#F5B400':'#FF6B6B';
const critColor=v=>v>=9?'#0E8A4F':v>=7?'#2F80ED':v>=5?'#E0A800':'#C4121D';
function aiMarkText(text,ms){   // underline each mistake's fragment inside the student's own text
  const T=String(text||''),L=T.toLowerCase(),sp=[];
  ms.forEach((m,i)=>{const o=String(m.original||'').trim().toLowerCase();if(o.length<2)return;let from=0;
    for(;;){const k=L.indexOf(o,from);if(k<0)return;const e=k+o.length;if(!sp.some(s=>k<s.e&&e>s.s)){sp.push({s:k,e,i});return}from=k+1}});
  sp.sort((a,b)=>a.s-b.s);let out='',p=0;
  const nErr=ms.filter(x=>x.kind!=='tip').length;
  sp.forEach(s=>{const m=ms[s.i],tip=m.kind==='tip';out+=esc(T.slice(p,s.s))+`<mark data-mi="${s.i}" class="ty-${aiTy(m)}${tip?' tp':''}" tabindex="0" role="button">${esc(T.slice(s.s,s.e))}<sup>${tip?'T'+(s.i+1-nErr):s.i+1}</sup></mark>`;p=s.e});
  return out+esc(T.slice(p));
}
// colour group of a mistake: grammar / vocabulary / spelling / punctuation / other (style, register, organisation)
const aiTy=m=>['grammar','vocabulary','spelling','punctuation'].indexOf(m.type)>=0?m.type:'other';
const AI_TYN={grammar:'Grammatika',vocabulary:'Lug‘at',spelling:'Imlo',punctuation:'Tinish belgisi',other:'Uslub'};
function aiRadar(r,C0){   // small chart of the criteria (0–10)
  const C=C0||aiCrit(r),n=C.length,R=64,cx=95,cy=88;if(n<3)return '';
  const pt=(i,v)=>{const a=(-90+i*360/n)*Math.PI/180;return [cx+Math.cos(a)*R*v,cy+Math.sin(a)*R*v]};
  const ring=f=>C.map((_,i)=>pt(i,f).map(x=>x.toFixed(1)).join(',')).join(' ');
  const val=C.map(([k],i)=>pt(i,Math.max(.04,(r.scores[k]||0)/10)).map(x=>x.toFixed(1)).join(',')).join(' ');
  return `<svg class="radar" viewBox="-30 -4 250 186" role="img" aria-label="Mezonlar diagrammasi">
    ${[.25,.5,.75,1].map(f=>`<polygon points="${ring(f)}" class="rg"/>`).join('')}
    ${C.map((_,i)=>{const[x,y]=pt(i,1);return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rg"/>`}).join('')}
    <polygon points="${val}" class="rv"/>
    ${C.map((c,i)=>{const[x,y]=pt(i,1.28);return `<text x="${x.toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="middle">${esc(c[2])}</text>`}).join('')}</svg>`;
}
/* shareable score card (PNG) — drawn on a canvas, then shared or downloaded */
async function aiShare(r,o){   // o (optional): {kind, title, big, unit, crit}
  o=o||{};const C=o.crit||aiCrit(r),big=String(o.big!=null?o.big:(r.max?r.points:r.score75)),unit=o.unit||'/'+(r.max||75);
  const W=1080,Hh=1080,cv=document.createElement('canvas');cv.width=W;cv.height=Hh;const x=cv.getContext('2d');
  try{await document.fonts.load('800 60px Onest')}catch(e){}
  const F=(w,s)=>`${w} ${s}px Onest, system-ui, sans-serif`;
  const g=x.createLinearGradient(0,0,W,Hh);g.addColorStop(0,'#141B2D');g.addColorStop(1,'#2B3A67');x.fillStyle=g;x.fillRect(0,0,W,Hh);
  x.fillStyle='#E3101F';x.fillRect(0,0,W,14);
  x.fillStyle='#fff';x.font=F(800,44);x.fillText('EDUNEST',80,120);x.fillStyle='rgba(255,255,255,.7)';x.font=F(600,32);x.fillText((o.kind||'AI Writing')+' · Multi-Level',80,168);
  const nm=(()=>{let p=null;try{p=JSON.parse(ls(ST+'p:'+UID)||'null')}catch(e){}return p&&p.student?p.student.name:''})();
  x.fillStyle='#fff';x.font=F(700,40);x.fillText(nm,80,270);x.fillStyle='rgba(255,255,255,.75)';x.font=F(500,32);x.fillText(o.title||(AI_T[r.type]||{}).n||'Writing',80,320);
  x.fillStyle='#fff';x.font=F(800,190);x.fillText(big,80,520);
  const wN=x.measureText(big).width;x.font=F(700,64);x.fillStyle='rgba(255,255,255,.7)';x.fillText(unit,90+wN,520);
  x.fillStyle=lvColor(r.level);x.beginPath();x.roundRect?x.roundRect(80,560,330,70,35):x.rect(80,560,330,70);x.fill();x.fillStyle='#141B2D';x.font=F(800,36);x.fillText('Daraja: '+lvShort(r.level),110,607);
  C.forEach(([k,n],i)=>{const y=700+i*62,v=(r.scores||{})[k]||0;x.fillStyle='rgba(255,255,255,.85)';x.font=F(600,30);x.fillText(n,80,y);
    x.fillStyle='rgba(255,255,255,.18)';x.fillRect(560,y-22,360,16);x.fillStyle=critColor(v);x.fillRect(560,y-22,36*v,16);x.fillStyle='#fff';x.font=F(700,30);x.fillText(v+'/10',940,y)});
  x.fillStyle='rgba(255,255,255,.55)';x.font=F(500,26);x.fillText('Taxminiy AI bahosi · toxirovteacher.github.io/edunest-multilevel',80,1030);
  const blob=await new Promise(res=>cv.toBlob(res,'image/png'));const file=new File([blob],o.kind?'EDUNEST-speaking-natija.png':'EDUNEST-writing-natija.png',{type:'image/png'});
  try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'EDUNEST '+(o.kind||'AI Writing')+' natijam'});return}}catch(e){if(e&&e.name==='AbortError')return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
const miHTML=(m,i,n)=>`<div class="mi${m.kind==='tip'?' tip':''}" data-k="${i}"><div class="mt"><em>${m.kind==='tip'?'T'+n:n}</em>${esc(AI_MT[m.type]||m.type)}</div>
  <div class="fx"><del>${esc(m.original)}</del> → <ins>${esc(m.correction)}</ins></div><p>${esc(m.explain_uz)}</p></div>`;
/* full result view. opts: {onRewrite, onAnother, anotherLabel} for the action buttons */
function aiResult(host,r,text,opts){
  opts=opts||{};
  // older results have no "kind": treat every item as an error; errors always come before tips
  const all=(r.mistakes||[]).map(m=>Object.assign({},m,{kind:m.kind==='tip'?'tip':'error'}));
  const er=all.filter(m=>m.kind==='error'),tp=all.filter(m=>m.kind==='tip'),ms=er.concat(tp),li=a=>(a||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  const pct=r.pct!=null?r.pct:Math.round((r.score75||0)/75*100),tt=AI_T[r.type],tys=[...new Set(ms.map(aiTy))];
  const vu=(r.vocab_upgrades||[]).filter(v=>v&&v.word&&(v.options||[]).length),msn=r.model_sentence;
  host.innerHTML=`<div class="air">
    <div class="hd2" style="--lc:${lvColor(r.level)}"><div class="hdl">
        <small>${tt?esc(tt.n.toUpperCase()):'WRITING'} · TAXMINIY BAHO</small>
        <div class="big"><b>${r.max?r.points:r.score75}</b><span>/${r.max||75}</span></div>
        <span class="lvp">Daraja: ${esc(r.level)}</span>
        <div class="pbar"><i style="width:${pct}%"></i></div>
        <p>${pct}% · ${r.words} so‘z (maqsad ${r.lo}–${r.hi})${r.max?` · 75 ballik shkalada ${r.score75}`:''}</p></div>
      ${aiRadar(r)}</div>
    <div class="sec"><h4>Ekzaminator xulosasi</h4><p class="sum">${esc(r.summary_uz)}</p>${r.word_note_uz?`<p class="wnote">${esc(r.word_note_uz)}</p>`:''}</div>
    <div class="sec"><h4>${aiCrit(r).length} mezon bo‘yicha</h4><div class="cgrid">${aiCrit(r).map(([k,n])=>{const v=(r.scores||{})[k]||0;
      return `<div class="cc" style="--cc:${critColor(v)}"><div class="top"><span>${n}</span><b>${v}/10</b></div><div class="bar2"><i style="width:${v*10}%"></i></div><p>${esc((r.criteria_uz||{})[k]||'')}</p></div>`}).join('')}</div></div>
    ${(r.strengths_uz||[]).length?`<div class="sec good"><h4>Yaxshi tomonlar</h4><ul class="ok">${li(r.strengths_uz)}</ul></div>`:''}
    <div class="sec"><h4>Sizning matningiz · ${er.length} ta xato${tp.length?` · ${tp.length} ta tavsiya`:''}</h4>
      ${ms.length?`<p class="legend">${tys.map(t=>`<span class="lg ty-${t}">${AI_TYN[t]}</span>`).join('')}${tp.length?'<span class="lg tp">tavsiya</span>':''}<em>belgilangan joyni bosing — tuzatish chiqadi</em></p>`:''}
      <div class="yt">${aiMarkText(text,ms)}</div></div>
    ${er.length?`<div class="sec"><h4>Xatolar (${er.length})</h4><p class="sub2">Bular haqiqiy xatolar — albatta tuzating.</p><div class="ms">${er.map((m,i)=>miHTML(m,i,i+1)).join('')}</div></div>`
      :`<div class="sec"><h4>Xatolar</h4><p class="sum">Xato topilmadi — zo‘r! 👏</p></div>`}
    ${tp.length?`<div class="sec"><h4>Tavsiyalar (${tp.length})</h4><p class="sub2">Bu xato emas — matningiz to‘g‘ri. Lekin shunday yozsangiz, yanada kuchliroq bo‘ladi.</p><div class="ms">${tp.map((m,i)=>miHTML(m,er.length+i,i+1)).join('')}</div></div>`:''}
    ${vu.length?`<div class="sec"><h4>So‘z boyligini oshiring</h4><div class="vup">${vu.map(v=>`<div class="vr"><span class="vw">${esc(v.word)}</span><span class="va">→</span>${v.options.map(o=>`<span class="vo">${esc(o)}</span>`).join('')}</div>`).join('')}</div></div>`:''}
    ${msn&&msn.original?`<div class="sec"><h4>Namuna gap — bir daraja yuqori</h4><p class="sub2">Eng zaif gapingiz shunday yozilishi mumkin:</p><div class="msent"><p class="mo">${esc(msn.original)}</p><p class="mn">${esc(msn.improved)}</p></div></div>`:''}
    ${(r.useful_phrases||[]).length?`<div class="sec"><h4>Foydali iboralar</h4><div class="chips2">${r.useful_phrases.map(x=>`<span>${esc(x)}</span>`).join('')}</div></div>`:''}
    ${(r.next_steps_uz||[]).length?`<div class="sec"><h4>Keyingi safar nima qilish kerak</h4><ul class="nx">${li(r.next_steps_uz)}</ul></div>`:''}
    ${r.improved?`<div class="sec"><h4>Yaxshilangan variant</h4><button class="tgl" type="button">Yaxshilangan variantni ko‘rish · ${wcount(r.improved)} so‘z</button><div class="imp" hidden>${esc(r.improved)}</div></div>`:''}
    <div class="sec acts"><button type="button" class="ashare">Natijani ulashish</button>
      ${opts.onRewrite?'<button type="button" class="aredo">Qayta yozish</button>':''}${opts.onAnother?`<button type="button" class="anext">${esc(opts.anotherLabel||'Boshqa topshiriq')}</button>`:''}</div>
    <p class="note">Bu AI bahosi — taxminiy. Rasmiy imtihon natijasi farq qilishi mumkin. Xatolarni o‘zingiz tuzatib, qayta tekshiring.</p></div>`;
  // tap a marked fragment → small bubble with the correction right there
  const yt=host.querySelector('.yt');let pop=null;
  const close=()=>{if(pop){pop.remove();pop=null}};
  host.querySelectorAll('mark[data-mi]').forEach(mk=>{const open=e=>{e.stopPropagation();const m=ms[+mk.dataset.mi];if(!m)return;const same=pop&&pop.dataset.k===mk.dataset.mi;close();if(same)return;
    pop=document.createElement('div');pop.className='mpop'+(m.kind==='tip'?' tip':'');pop.dataset.k=mk.dataset.mi;
    pop.innerHTML=`<div class="fx"><del>${esc(m.original)}</del> → <ins>${esc(m.correction)}</ins></div><p>${esc(m.explain_uz)}</p><button type="button">Batafsil ↓</button>`;
    yt.appendChild(pop);const left=Math.max(0,Math.min(mk.offsetLeft,yt.clientWidth-pop.offsetWidth-4));pop.style.left=left+'px';pop.style.top=(mk.offsetTop+mk.offsetHeight+6)+'px';
    pop.querySelector('button').onclick=ev=>{ev.stopPropagation();close();const t=host.querySelector(`.mi[data-k="${mk.dataset.mi}"]`);
      if(t){t.scrollIntoView({behavior:'smooth',block:'center'});t.classList.remove('flash');void t.offsetWidth;t.classList.add('flash')}}};
    mk.onclick=open;mk.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(e)}}});
  host.querySelector('.air').addEventListener('click',close);
  const tg=host.querySelector('.tgl');if(tg)tg.onclick=()=>{tg.nextElementSibling.hidden=false;tg.remove()};
  const sb=host.querySelector('.ashare');sb.onclick=async()=>{sb.disabled=true;try{await aiShare(r)}finally{sb.disabled=false}};
  const rd=host.querySelector('.aredo');if(rd)rd.onclick=opts.onRewrite;const nx=host.querySelector('.anext');if(nx)nx.onclick=opts.onAnother;
}
/* ================= AI SPEAKING (same Gemini key, through the EDUNEST script) =================
 * Each answer is recorded with MediaRecorder, decoded and resampled to 16 kHz mono WAV in the browser,
 * then all answers of one part go to the script in one request. The audio is not stored anywhere. */
const SP_C=[['fluency','Ravonlik va izchillik','Ravonlik'],['vocabulary','Lug‘at boyligi','Lug‘at'],['grammar','Grammatika','Grammatika'],['pronunciation','Talaffuz','Talaffuz']];
const SP_P={
  '1.1':{n:'Part 1.1 · Suhbat',lv:'A2',d:'3 ta shaxsiy savol',t:'3 × 30 soniya',tip:['Har bir savolga 30 soniya beriladi — 2–3 gap bilan javob bering.','Javobingizga shaxsiy misol yoki sabab qo‘shing.','Hozirgi va o‘tgan zamonni tabiiy ishlating.']},
  '1.2':{n:'Part 1.2 · Taqqoslash',lv:'B1',d:'Ikki holatni taqqoslang, so‘ng 2 ta savol',t:'45 s + 2 × 30 s',tip:['Avval ikkala holatni tasvirlang, keyin o‘xshash va farqli tomonlarini ayting.','“whereas”, “on the other hand”, “both… and…” kabi bog‘lovchilarni ishlating.','O‘z fikringizni sabab bilan bildiring.']},
  '2':{n:'Part 2 · Monolog',lv:'B2',d:'Bitta mavzu, 3 ta savol',t:'1 daq tayyorgarlik · 2 daq nutq',tip:['1 daqiqa ichida har bir savol uchun 2–3 ta kalit so‘z o‘ylab qo‘ying.','Uchala savolga ham tartib bilan javob bering.','2 daqiqa davomida to‘xtamasdan gapirishga harakat qiling.']},
  '3':{n:'Part 3 · Munozara',lv:'C1',d:'Fikrni ikki tomondan muhokama qiling',t:'1 daq tayyorgarlik · 2 daq nutq',tip:['Jadvaldagi “tarafdor” va “qarshi” fikrlardan kamida ikkitadan foydalaning.','O‘z fikringizni aniq ayting va asoslang.','Xulosa bilan yakunlang.']}};
/* question bank: sp/bank.json (Part 1.1 questions by topic, Part 1.2 pairs with real photos in sp/, Parts 2 and 3).
 * Built from speaking/ by platform/build.py. A set is not repeated until the student has seen every set of that part. */
let SP_BANK=null;
async function spLoad(){if(SP_BANK)return SP_BANK;const r=await fetch('sp/bank.json',{cache:'no-cache'});if(!r.ok)throw new Error('bank');SP_BANK=await r.json();return SP_BANK}
function spPick(part){
  const B=SP_BANK,key=ST+'sp:seen:'+part,rnd=a=>a[Math.floor(Math.random()*a.length)],shuf=a=>a.map(x=>[Math.random(),x]).sort((p,q)=>p[0]-q[0]).map(x=>x[1]);
  let seen=[];try{seen=JSON.parse(ls(key)||'[]')}catch(e){}if(!Array.isArray(seen))seen=[];
  if(part==='1.1'){   // 3 questions from 3 different topics
    const all=[];Object.keys(B.p11).forEach(t=>B.p11[t].forEach((q,i)=>all.push({id:t+':'+i,t,q})));
    let fresh=all.filter(x=>seen.indexOf(x.id)<0);if(new Set(fresh.map(x=>x.t)).size<3){seen=[];fresh=all}
    const out=shuf([...new Set(fresh.map(x=>x.t))]).slice(0,3).map(t=>rnd(fresh.filter(x=>x.t===t)));
    lset(key,JSON.stringify(seen.concat(out.map(x=>x.id))));return out.map(x=>x.q)}
  const L=part==='1.2'?B.p12:part==='2'?B.p2:B.p3;
  let fresh=L.map(x=>x.id).filter(id=>seen.indexOf(id)<0);if(!fresh.length){seen=[];fresh=L.map(x=>x.id)}
  const id=rnd(fresh),x=L.find(y=>y.id===id);lset(key,JSON.stringify(seen.concat([id])));
  return part==='1.2'?{a:[x.a.img,x.a.t],b:[x.b.img,x.b.t],q1:x.q1,qs:x.qs}:part==='2'?{t:x.t,qs:x.qs}:{s:x.s,f:x.f,g:x.g}}
function spPreload(set){if(set&&set.a&&set.b)[set.a[0],set.b[0]].forEach(u=>{const im=new Image();im.decoding='async';im.src=u})}
function spSteps(part,set){   // what is asked, what the student sees, preparation and speaking time (seconds)
  if(part==='1.1')return set.map(q=>({q,prep:5,rec:30,say:q}));
  if(part==='1.2'){const q1=set.q1||'Describe and compare the two pictures.';   // the AI cannot see the photos: the question carries what they show
    return [{q:`${q1} (Describe and compare two photos. Picture A: ${set.a[1]}. Picture B: ${set.b[1]}.)`,h:q1,prep:10,rec:45,say:q1}].concat(set.qs.map(q=>({q,prep:5,rec:30,say:q})))}
  if(part==='2')return [{q:set.t+' You should say: '+set.qs.map(x=>x.replace(/[.?!\s]+$/,'')).join('; ')+'.',prep:60,rec:120,say:'You have one minute to prepare. '+set.t}];
  return [{q:'Discuss the statement: "'+set.s+'" Arguments for: '+set.f.join('; ')+'. Arguments against: '+set.g.join('; ')+'. Discuss both sides and give your own opinion.',prep:60,rec:120,say:'You have one minute to prepare. Discuss both sides of the statement and give your opinion.'}];
}
function spCard(part,set){   // the prompt card shown on screen during the part
  if(part==='1.2')return `<div class="spics" onclick="this.classList.toggle('zoom')">${[set.a,set.b].map((p,i)=>`<figure class="spic"><img src="${esc(p[0])}" alt="${esc(p[1])}" decoding="async"><b>${'AB'[i]}</b></figure>`).join('')}</div>`;
  if(part==='2')return `<div class="sptopic"><b>${esc(set.t)}</b><p class="spsay">You should say:</p><ul>${set.qs.map(q=>`<li>${esc(q)}</li>`).join('')}</ul></div>`;
  if(part==='3')return `<div class="sptopic"><b>“${esc(set.s)}”</b><div class="spfg"><div><h5>Tarafdor (For)</h5><ul>${set.f.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div><div><h5>Qarshi (Against)</h5><ul>${set.g.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div></div>`;
  return '';
}
let SPS=null;
async function spMic(){if(SPS&&SPS.active)return SPS;SPS=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});return SPS}
function spMicOff(){try{if(SPS)SPS.getTracks().forEach(t=>t.stop())}catch(e){}SPS=null}
addEventListener('pagehide',spMicOff);
function spRec(stream){
  const t=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(x=>window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(x));
  const mr=new MediaRecorder(stream,t?{mimeType:t}:undefined),ch=[],t0=Date.now();mr.ondataavailable=e=>{if(e.data&&e.data.size)ch.push(e.data)};mr.start(250);
  return {stop:()=>new Promise(res=>{mr.onstop=()=>res({blob:new Blob(ch,{type:mr.mimeType||t||'audio/webm'}),sec:(Date.now()-t0)/1000});try{mr.stop()}catch(e){res({blob:new Blob(ch),sec:0})}})};
}
async function spWav(blob){   // any recorded format → 16 kHz mono 16-bit WAV (base64) + loudness
  const AC=window.AudioContext||window.webkitAudioContext,ac=new AC(),ab=await blob.arrayBuffer();
  const buf=await new Promise((ok,no)=>{const p=ac.decodeAudioData(ab,ok,no);if(p&&p.then)p.then(ok,no)});try{ac.close()}catch(e){}
  const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext,off=new OAC(1,Math.max(1,Math.ceil(buf.duration*16000)),16000);
  const src=off.createBufferSource();src.buffer=buf;src.connect(off.destination);src.start(0);const d=(await off.startRendering()).getChannelData(0);
  let sq=0,pk=0;for(let i=0;i<d.length;i++){sq+=d[i]*d[i];const a=Math.abs(d[i]);if(a>pk)pk=a}
  const rms=Math.sqrt(sq/Math.max(1,d.length)),gain=pk>0&&pk<.5?Math.min(4,.5/pk):1;
  const dv=new DataView(new ArrayBuffer(44+d.length*2)),w=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');dv.setUint32(4,36+d.length*2,true);w(8,'WAVE');w(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
  dv.setUint32(24,16000,true);dv.setUint32(28,32000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,'data');dv.setUint32(40,d.length*2,true);
  for(let i=0;i<d.length;i++){const v=Math.max(-1,Math.min(1,d[i]*gain));dv.setInt16(44+i*2,v<0?v*0x8000:v*0x7FFF,true)}
  const wav=new Blob([dv],{type:'audio/wav'});const b64=await new Promise(ok=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(',')[1]||'');fr.readAsDataURL(wav)});
  return {b64,sec:buf.duration,rms,url:URL.createObjectURL(wav)};
}
function spSay(t){return new Promise(res=>{let done=false;const fin=()=>{if(!done){done=true;res()}};try{if(!window.speechSynthesis)return fin();speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(t),vs=speechSynthesis.getVoices();u.lang='en-GB';u.rate=.95;const v=vs.find(v=>/^en[-_]GB/i.test(v.lang))||vs.find(v=>/^en/i.test(v.lang));if(v)u.voice=v;
  u.onend=u.onerror=fin;speechSynthesis.speak(u);setTimeout(fin,Math.min(15000,1500+t.length*90))}catch(e){fin()}})}
function spBeep(){try{const c=new (window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.setValueAtTime(.18,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.35);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.36);setTimeout(()=>c.close&&c.close(),600)}catch(e){}}
async function aiSpeak(part,items){
  if(!SESSION||!SESSION.t)return {ok:false,error:'auth'};
  const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),240000);
  try{const r=await fetch(CLOUD_URL,{method:'POST',body:JSON.stringify({action:'aispeak',id:SESSION.id,t:SESSION.t,part,items}),signal:ctl.signal});return await r.json()}
  catch(e){return {ok:false,error:'net'}}finally{clearTimeout(tm)}
}
function spResult(host,r,opts){
  opts=opts||{};const P=SP_P[String(r.type||'').slice(1)]||{n:'Speaking'},li=a=>(a||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  const ms=(r.mistakes||[]).map(m=>Object.assign({},m,{kind:'error'})),qs=r.qs||[],tr=r.transcripts||[];
  host.innerHTML=`<div class="air sp">
    <div class="hd2" style="--lc:${lvColor(r.level)}"><div class="hdl"><small>${esc(P.n.toUpperCase())} · TAXMINIY BAHO</small>
      <div class="big"><b>${r.pct}</b><span>%</span></div><span class="lvp">Daraja: ${esc(r.level)}</span>
      <div class="pbar"><i style="width:${r.pct}%"></i></div><p>${r.total}/40 · 75 ballik shkalada ${r.score75} · ${r.words} so‘z aytildi</p></div>${aiRadar(r,SP_C)}</div>
    <div class="sec"><h4>Ekzaminator xulosasi</h4><p class="sum">${esc(r.summary_uz)}</p></div>
    <div class="sec"><h4>4 mezon bo‘yicha</h4><div class="cgrid">${SP_C.map(([k,n])=>{const v=(r.scores||{})[k]||0;
      return `<div class="cc" style="--cc:${critColor(v)}"><div class="top"><span>${n}</span><b>${v}/10</b></div><div class="bar2"><i style="width:${v*10}%"></i></div><p>${esc((r.criteria_uz||{})[k]||'')}</p></div>`}).join('')}</div></div>
    ${(r.strengths_uz||[]).length?`<div class="sec good"><h4>Yaxshi tomonlar</h4><ul class="ok">${li(r.strengths_uz)}</ul></div>`:''}
    <div class="sec"><h4>Javoblaringiz (transkript)</h4><div class="spans">${qs.map((q,i)=>{const own=ms.filter(m=>aiNormTxt(tr[i]).indexOf(aiNormTxt(m.original))>=0);
      return `<div class="spa"><div class="spq"><em>Q${i+1}</em>${esc(q.length>220?q.slice(0,218)+'…':q)}</div>
        ${opts.urls&&opts.urls[i]?`<audio controls preload="none" src="${opts.urls[i]}"></audio>`:''}
        <div class="yt">${tr[i]?aiMarkText(tr[i],own):'<i class="muted2">Javob eshitilmadi</i>'}</div>${(r.notes_uz||[])[i]?`<p class="spn">${esc(r.notes_uz[i])}</p>`:''}</div>`}).join('')}</div></div>
    ${ms.length?`<div class="sec"><h4>Xatolar (${ms.length})</h4><div class="ms">${ms.map((m,i)=>miHTML(m,i,i+1)).join('')}</div></div>`:''}
    ${(r.pronunciation||[]).length?`<div class="sec"><h4>Talaffuz</h4><div class="vup">${r.pronunciation.map(p=>`<div class="vr"><span class="vw">${esc(p.word)}</span><span class="va">→</span><span class="spt">${esc(p.tip_uz)}</span></div>`).join('')}</div></div>`:''}
    ${(r.better||[]).length?`<div class="sec"><h4>Darajani oshiruvchi namunalar</h4><button class="tgl" type="button">Namuna javoblarni ko‘rish</button><div class="spb" hidden>${r.better.map(b=>`<div class="msent"><p class="mo">Q${b.q}: ${esc((qs[b.q-1]||'').slice(0,160))}</p><p class="mn">${esc(b.answer)}</p></div>`).join('')}</div></div>`:''}
    ${r.plan_uz?`<div class="sec"><h4>Mashq rejasi</h4><p class="sum">${esc(r.plan_uz)}</p></div>`:''}
    <div class="sec acts"><button type="button" class="ashare">Natijani ulashish</button>${opts.onAgain?'<button type="button" class="aredo">Qayta urinish</button>':''}${opts.onOther?'<button type="button" class="anext">Boshqa qism</button>':''}</div>
    <p class="note">Bu AI bahosi — taxminiy. Ovozingiz saqlanmaydi; matn (transkript) ustozingizga ko‘rinadi.</p></div>`;
  host.querySelectorAll('mark[data-mi]').forEach(mk=>mk.onclick=()=>{});
  const tg=host.querySelector('.tgl');if(tg)tg.onclick=()=>{tg.nextElementSibling.hidden=false;tg.remove()};
  const sb=host.querySelector('.ashare');sb.onclick=async()=>{sb.disabled=true;try{await aiShare(r,{kind:'AI Speaking',title:P.n,big:r.pct,unit:'%',crit:SP_C})}finally{sb.disabled=false}};
  const a=host.querySelector('.aredo');if(a)a.onclick=opts.onAgain;const b=host.querySelector('.anext');if(b)b.onclick=opts.onOther;
}
const aiNormTxt=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
function speakPage(){
  $('#ttl').textContent='AI Speaking yordamchi';$('#sub').textContent='Multi-Level · Speaking tekshiruvi';document.title='EDUNEST · AI Speaking yordamchi';
  $('#back').textContent='← Bosh sahifa';$('#back').href='./#/me';$('#jump').hidden=true;$('#foot').hidden=true;
  const M=$('#main');let run=null;   // run = {part, set, steps, i, ans[], rec, timer, stopped}
  const stopRun=()=>{if(!run)return;run.stopped=true;clearInterval(run.timer);try{speechSynthesis.cancel()}catch(e){}if(run.rec)run.rec.stop().catch(()=>{});spMicOff()};
  const pick=()=>{stopRun();run=null;
    M.innerHTML=`<div class="aip"><div class="aihero sp"><h1>AI Speaking yordamchi</h1><p>Imtihondagidek gapiring — AI ovozingizni tinglaydi, transkript qiladi, 4 mezon bo‘yicha baholaydi va har bir xatoni o‘zbekcha tushuntiradi.</p>
      <div class="feat"><span>Savollar ovozli o‘qiladi</span><span>Tayyorgarlik va javob taymeri</span><span>Transkript + xatolar</span><span>Namuna javoblar</span></div></div>
      <button type="button" class="spmock" id="smock"><span class="tyh"><i class="tyl">A2 → C1</i><em>≈ 12 daqiqa · 8 ta javob</em></span><b>🎓 To‘liq mock imtihon</b><small>4 qism ketma-ket, xuddi imtihondagidek: savollar ovozli o‘qiladi, tayyorgarlik va javob vaqti avtomatik. Oxirida umumiy ball va har bir qism tahlili.</small></button>
      <div class="spparts">${['1.1','1.2','2','3'].map(k=>`<button type="button" class="sppart" data-p="${k}"><span class="tyh"><i class="tyl">${SP_P[k].lv}</i><em>${SP_P[k].t}</em></span><b>${SP_P[k].n}</b><small>${SP_P[k].d}</small></button>`).join('')}</div>
      <div class="aistep" id="shs" hidden><h2>Mening natijalarim</h2><div id="sres"></div><div class="aihist" id="shl"></div></div>
      <p class="whint">Mikrofon kerak. Ovozingiz faqat baholash uchun AI'ga yuboriladi va hech qayerda saqlanmaydi. Matn (transkript) va natija ustozingizga ko‘rinadi.</p></div>`;
    document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>intro(b.dataset.p));$('#smock').onclick=mockIntro;hist()};
  const bankErr=()=>{M.innerHTML=`<div class="aip"><div class="aistep"><div class="aierr">Savollar yuklanmadi. Internetni tekshirib, sahifani yangilang.</div><button class="spback" type="button" id="sbk">← Orqaga</button></div></div>`;$('#sbk').onclick=pick};
  const intro=async part=>{stopRun();try{await spLoad()}catch(e){bankErr();return}const set=spPick(part);spPreload(set);
    run={part,set,steps:spSteps(part,set),i:0,ans:[]};const P=SP_P[part];
    M.innerHTML=`<div class="aip"><div class="aistep"><h2>${esc(P.n)} <i class="tyl">${P.lv}</i></h2><div class="sptips">${P.tip.map(t=>`<p>› ${esc(t)}</p>`).join('')}</div>
      <p class="sub2">${esc(P.t)}. Savollar ovoz bilan o‘qiladi, so‘ng signal chalinadi va yozib olish boshlanadi. Tinch joyda bo‘ling.</p>
      <button class="aib" type="button" id="sgo">🎙️ Boshlash</button><button class="spback" type="button" id="sbk">← Boshqa qismni tanlash</button><div id="smsg"></div></div></div>`;
    $('#sbk').onclick=pick;$('#sgo').onclick=async()=>{const b=$('#sgo');b.disabled=true;
      try{if(!navigator.mediaDevices||!window.MediaRecorder)throw new Error('nosupport');await spMic();step()}
      catch(e){b.disabled=false;$('#smsg').innerHTML=`<div class="aierr">${e&&e.message==='nosupport'?'Bu brauzer ovoz yozishni qo‘llab-quvvatlamaydi. Chrome yoki Safari’ning yangi versiyasini oching.':'Mikrofonga ruxsat berilmadi. Manzil satridagi 🔒 belgisini bosib, mikrofonga ruxsat bering va qayta urinib ko‘ring.'}</div>`}}};
  const frame=(phase,big,sub,btn)=>{const s=run.steps[run.i];
    M.innerHTML=`<div class="aip"><div class="spbar">${run.steps.map((_,j)=>`<i class="${j<run.i?'ok':j===run.i?'on':''}"></i>`).join('')}</div>
      <div class="aistep"><small class="spk">${run.mock?'To‘liq mock · ':''}${esc(SP_P[run.part].n)} · ${run.steps.length>1?`savol ${run.i+1} / ${run.steps.length}`:'monolog'}</small>
        ${run.part==='1.1'||run.i>0?`<h2 class="spqq">${esc(run.part==='1.2'&&run.i===0?'':s.q)}</h2>`:''}${run.part!=='1.1'&&run.i===0?spCard(run.part,run.set):''}${run.part==='1.2'&&run.i===0?`<h2 class="spqq">${esc(s.h||s.q)}</h2>`:''}</div>
      <div class="spclock ${phase}"><div class="ring"><b>${big}</b></div><p>${sub}</p>${btn||''}</div>
      ${run.ans.length?`<div class="aistep sprec"><h2>Yozib olinganlar</h2>${run.ans.map((a,j)=>`<div class="sprow"><em>Q${j+1}</em><audio controls preload="none" src="${a.url}"></audio><span>${Math.round(a.sec)} s</span></div>`).join('')}</div>`:''}
      <button class="spback" type="button" id="scx">Bekor qilish</button></div>`;
    $('#scx').onclick=()=>{if(confirm('Bu qism bekor qilinsinmi? Yozilganlar o‘chadi.'))pick()}};
  const count=(sec,onTick,onEnd)=>new Promise(res=>{let t=sec;onTick(t);run.timer=setInterval(()=>{if(run.stopped){clearInterval(run.timer);return}t--;onTick(t);if(t<=0){clearInterval(run.timer);res()}},1000);run.skip=()=>{clearInterval(run.timer);res()}});
  const step=async()=>{if(!run||run.stopped)return;const s=run.steps[run.i],me=run;
    frame('say','🔊','Savol o‘qilmoqda…');await spSay(s.say);if(me.stopped)return;
    const tick=u=>t=>{const b=document.querySelector('.spclock .ring b');if(b&&!me.stopped)b.textContent=t+u};
    frame('prep',s.prep,s.prep>=30?'Tayyorlaning — kalit so‘zlarni o‘ylang':'Tayyorlaning…',s.prep>=30?'<button type="button" class="spgo" id="sskip">Tayyorman — boshlash</button>':'');
    const pc=count(s.prep,tick(''));const k1=$('#sskip');if(k1)k1.onclick=()=>run.skip();await pc;if(me.stopped)return;
    spBeep();try{run.rec=spRec(await spMic())}catch(e){frame('err','!','Mikrofon ishlamayapti. Ruxsatni tekshiring.');return}
    frame('rec',s.rec+'s','<span class="dot"></span> Yozib olinmoqda…','<button type="button" class="spstop" id="sstop">Javobni tugatish</button>');
    const rc=count(s.rec,tick('s'));const k2=$('#sstop');if(k2)k2.onclick=()=>run.skip();await rc;if(me.stopped)return;
    const out=await run.rec.stop();run.rec=null;frame('save','…','Saqlanmoqda…');
    let w=null;try{w=await spWav(out.blob)}catch(e){w=null}if(me.stopped)return;
    run.ans.push(w?{b64:w.b64,sec:w.sec,rms:w.rms,url:w.url}:{b64:'',sec:0,rms:0,url:''});run.i++;
    if(run.i<run.steps.length)step();else if(run.mock)mockNext();else review()};
  const review=()=>{spMicOff();const quiet=run.ans.map((a,j)=>(!a.b64||a.rms<.004||a.sec<2)?j+1:0).filter(Boolean);
    M.innerHTML=`<div class="aip"><div class="spbar">${run.steps.map(()=>'<i class="ok"></i>').join('')}</div><div class="aistep"><h2>✅ Hammasi yozib olindi</h2>
      ${run.ans.map((a,j)=>`<div class="sprow"><em>Q${j+1}</em>${a.url?`<audio controls preload="none" src="${a.url}"></audio>`:''}<span>${Math.round(a.sec)} s</span></div>`).join('')}
      ${quiet.length?`<div class="aierr">${quiet.map(n=>'Q'+n).join(', ')} — ovozingiz deyarli eshitilmadi. Qayta yozib olishni tavsiya qilamiz.</div>`:''}
      <button class="aib" type="button" id="sgr">${AI_ICON} AI bilan baholash</button><button class="spback" type="button" id="sre">↻ Qayta yozib olish</button><div id="sout"></div></div></div>`;
    $('#sre').onclick=()=>{const p=run.part,st=run.set;run={part:p,set:st,steps:spSteps(p,st),i:0,ans:[]};spMic().then(step).catch(()=>intro(p))};
    $('#sgr').onclick=async()=>{const b=$('#sgr'),host=$('#sout');b.disabled=true;$('#sre').hidden=true;
      const stop=aiLoading(host);host.querySelector('b').textContent='Ovozingiz tinglanmoqda…';
      const j=await aiSpeak(run.part,run.steps.map((s,k)=>({q:s.q,a:run.ans[k].b64,sec:Math.round(run.ans[k].sec)})));stop();
      if(!j||!j.ok){b.disabled=false;$('#sre').hidden=false;host.innerHTML=`<div class="aierr">${esc(AI_ERR[j&&j.error]||AI_ERR.fail)}</div>`;return}
      const p=run.part,urls=run.ans.map(a=>a.url);M.innerHTML='<div class="aip"><div id="sfin"></div></div>';
      spResult($('#sfin'),j.r,{urls,onAgain:()=>intro(p),onOther:pick});scrollTo({top:0})}};
  async function hist(){
    try{const ctl=new AbortController();setTimeout(()=>ctl.abort(),20000);
      const j=await (await fetch(CLOUD_URL+'?action=aihist&id='+encodeURIComponent(SESSION.id)+'&t='+encodeURIComponent(SESSION.t),{signal:ctl.signal})).json();
      if(!j||!j.ok||!$('#shl'))return;
      if(!j.on)$('#sres').innerHTML=`<div class="aierr">${AI_ERR.off}</div>`;
      const C=j.checks.filter(c=>/^S/.test(c.type)&&c.r);if(!C.length){if(!j.on)$('#shs').hidden=false;return}$('#shs').hidden=false;
      $('#shl').innerHTML=C.map((c,i)=>`<button type="button" data-h="${i}"><span class="hl" style="background:${lvColor(c.level)}">${esc(lvShort(c.level))}</span><span class="hx"><b>${esc((SP_P[c.type.slice(1)]||{n:c.type}).n)} · ${c.r.pct}%</b><small>${esc(new Date(c.at).toLocaleString())} · ${c.words} so‘z</small></span></button>`).join('');
      document.querySelectorAll('#shl [data-h]').forEach(b=>b.onclick=()=>{const c=C[+b.dataset.h];M.innerHTML='<div class="aip"><div id="sfin"></div></div>';spResult($('#sfin'),c.r,{onAgain:()=>intro(c.type.slice(1)),onOther:pick});scrollTo({top:0})});
    }catch(e){}
  }
  /* ---------- full mock: Part 1.1 → 1.2 → 2 → 3 in one go, like the real exam; graded part by part at the end ---------- */
  let mock=null;
  const mockIntro=async()=>{stopRun();try{await spLoad()}catch(e){bankErr();return}
    const parts=['1.1','1.2','2','3'].map(p=>({part:p,set:spPick(p)}));spPreload(parts[1].set);
    M.innerHTML=`<div class="aip"><div class="aistep"><h2>🎓 To‘liq mock imtihon</h2><div class="sptips">
      <p>› 4 qism ketma-ket: Part 1.1 → 1.2 → 2 → 3, xuddi haqiqiy imtihondagidek.</p><p>› Savollar ovoz bilan o‘qiladi, signaldan keyin javob yozib olinadi. Vaqt tugasa, keyingi savol avtomatik boshlanadi.</p>
      <p>› Imtihon orasida to‘xtab qolmang — tinch joyda, mikrofonni tekshirib boshlang.</p><p>› Oxirida AI 4 qismni ham tekshiradi: umumiy ball (75 dan), daraja va har bir qism tahlili.</p></div>
      <p class="sub2">Taxminan 12 daqiqa · 8 ta javob · har safar yangi savollar</p>
      <button class="aib" type="button" id="mgo">🎙️ Imtihonni boshlash</button><button class="spback" type="button" id="sbk">← Orqaga</button><div id="smsg"></div></div></div>`;
    $('#sbk').onclick=pick;$('#mgo').onclick=async()=>{const b=$('#mgo');b.disabled=true;
      try{if(!navigator.mediaDevices||!window.MediaRecorder)throw new Error('nosupport');await spMic();mock={parts,k:0,done:[],res:{}};mockPart()}
      catch(e){b.disabled=false;$('#smsg').innerHTML=`<div class="aierr">${e&&e.message==='nosupport'?'Bu brauzer ovoz yozishni qo‘llab-quvvatlamaydi. Chrome yoki Safari’ning yangi versiyasini oching.':'Mikrofonga ruxsat berilmadi. Manzil satridagi 🔒 belgisini bosib, mikrofonga ruxsat bering va qayta urinib ko‘ring.'}</div>`}}};
  const mockBar=()=>`<div class="spbar">${mock.parts.map((_,j)=>`<i class="${j<mock.k?'ok':j===mock.k?'on':''}"></i>`).join('')}</div>`;
  const mockPart=async()=>{const p=mock.parts[mock.k],me={part:p.part,set:p.set,steps:spSteps(p.part,p.set),i:0,ans:[],mock:true};run=me;
    M.innerHTML=`<div class="aip">${mockBar()}<div class="aistep spnext"><small class="spk">To‘liq mock · ${mock.k+1} / 4</small><h2>${esc(SP_P[p.part].n)}</h2><p class="sub2">${esc(SP_P[p.part].t)}</p></div>
      <button class="spback" type="button" id="scx">Imtihonni bekor qilish</button></div>`;
    $('#scx').onclick=()=>{if(confirm('Mock imtihon bekor qilinsinmi? Yozilganlar o‘chadi.'))pick()};
    await spSay(['Part one point one.','Part one point two.','Part two.','Part three.'][mock.k]);await new Promise(r=>setTimeout(r,1200));
    if(me.stopped||run!==me)return;step()};
  const mockNext=()=>{mock.done.push({part:run.part,set:run.set,steps:run.steps,ans:run.ans});mock.k++;if(mock.k<mock.parts.length)mockPart();else mockReview()};
  const mockReview=()=>{spMicOff();
    const quiet=[];mock.done.forEach(d=>d.ans.forEach((a,j)=>{if(!a.b64||a.rms<.004||a.sec<2)quiet.push(d.part+' Q'+(j+1))}));
    M.innerHTML=`<div class="aip"><div class="spbar">${mock.parts.map(()=>'<i class="ok"></i>').join('')}</div><div class="aistep"><h2>✅ Imtihon tugadi — hammasi yozib olindi</h2>
      ${mock.done.map(d=>`<small class="spk" style="margin-top:12px">${esc(SP_P[d.part].n)}</small>${d.ans.map((a,j)=>`<div class="sprow"><em>Q${j+1}</em>${a.url?`<audio controls preload="none" src="${a.url}"></audio>`:''}<span>${Math.round(a.sec)} s</span></div>`).join('')}`).join('')}
      ${quiet.length?`<div class="aierr">${quiet.join(', ')} — ovozingiz deyarli eshitilmadi. Shu qismlar past baholanishi mumkin.</div>`:''}
      <button class="aib" type="button" id="mgr">${AI_ICON} AI bilan baholash (4 qism)</button><button class="spback" type="button" id="mre">↻ Yangi savollar bilan qaytadan</button><div id="sout"></div></div></div>`;
    $('#mre').onclick=()=>{if(confirm('Yozilganlar o‘chadi. Yangi mock boshlansinmi?'))mockIntro()};$('#mgr').onclick=mockGrade};
  const mockGrade=async()=>{const b=$('#mgr'),host=$('#sout');b.disabled=true;$('#mre').hidden=true;
    for(let i=0;i<mock.done.length;i++){const d=mock.done[i];if(mock.res[d.part])continue;
      const stop=aiLoading(host);host.querySelector('b').textContent=`${SP_P[d.part].n} tekshirilmoqda (${i+1}/4)…`;
      const j=await aiSpeak(d.part,d.steps.map((s,k)=>({q:s.q,a:d.ans[k].b64,sec:Math.round(d.ans[k].sec)})));stop();
      if(!j||!j.ok){b.disabled=false;b.innerHTML=AI_ICON+' Qolgan qismlarni tekshirish';host.innerHTML=`<div class="aierr">${esc(SP_P[d.part].n)}: ${esc(AI_ERR[j&&j.error]||AI_ERR.fail)} Tekshirilgan qismlar saqlanib qoldi.</div>`;return}
      mock.res[d.part]=j.r}
    mockResult()};
  const mockResult=()=>{const R=mock.done.map(d=>mock.res[d.part]),n=R.length,sum=f=>R.reduce((s,r)=>s+(+f(r)||0),0);
    const avg=Math.round(sum(r=>r.score75)/n),lv=avg>=65?'C1':avg>=51?'B2':avg>=38?'B1':'B1 dan past',sc={};SP_C.forEach(([k])=>sc[k]=Math.round(sum(r=>(r.scores||{})[k])/n*10)/10);
    M.innerHTML=`<div class="aip"><div class="air sp"><div class="hd2" style="--lc:${lvColor(lv)}"><div class="hdl"><small>TO‘LIQ MOCK · TAXMINIY UMUMIY BAHO</small>
        <div class="big"><b>${avg}</b><span>/75</span></div><span class="lvp">Daraja: ${esc(lv)}</span><div class="pbar"><i style="width:${Math.round(avg/75*100)}%"></i></div>
        <p>4 qism o‘rtachasi · ${sum(r=>r.words)} so‘z aytildi</p></div>${aiRadar({scores:sc},SP_C)}</div>
      <div class="sec"><h4>Qismlar bo‘yicha</h4><div class="mkparts">${mock.done.map((d,i)=>`<button type="button" class="mkp" data-i="${i}"><span class="hl" style="background:${lvColor(R[i].level)}">${esc(lvShort(R[i].level))}</span><span><b>${esc(SP_P[d.part].n)}</b><small>${R[i].score75}/75 · ${R[i].pct}%</small></span><em>Batafsil →</em></button>`).join('')}</div></div>
      <div class="sec acts"><button type="button" class="aredo" id="mnew">Yangi mock</button><button type="button" class="anext" id="mback">Bosh menyu</button></div>
      <p class="note">Bu AI bahosi — taxminiy (4 qism ballarining o‘rtachasi). Ovozingiz saqlanmaydi; transkript ustozingizga ko‘rinadi.</p></div></div>`;
    $('#mnew').onclick=mockIntro;$('#mback').onclick=pick;
    document.querySelectorAll('.mkp').forEach(b=>b.onclick=()=>{const d=mock.done[+b.dataset.i];
      M.innerHTML='<div class="aip"><button class="spback" type="button" id="mres" style="margin:0 0 10px">← Umumiy natija</button><div id="sfin"></div></div>';$('#mres').onclick=mockResult;
      spResult($('#sfin'),mock.res[d.part],{urls:d.ans.map(a=>a.url)});scrollTo({top:0})});
    scrollTo({top:0})};
  pick();
}
/* progress from the student's last checks: average level, weakest criterion, trend, most repeated error types */
function aiInsights(C){
  const ok=C.filter(c=>c.r&&c.r.scores);if(!ok.length)return '';
  const avg=Math.round(ok.reduce((s,c)=>s+(c.score||0),0)/ok.length);const lv=avg>=65?'C1':avg>=51?'B2':avg>=38?'B1':'B1 dan past';
  const crit=AI_C.map(([k,n])=>{const w=ok.filter(c=>k in c.r.scores);return [n,w.length?w.reduce((s,c)=>s+(c.r.scores[k]||0),0)/w.length:99]}).sort((a,b)=>a[1]-b[1])[0];
  const d=ok.length>1?ok[0].score-ok[1].score:null;
  const cnt={};ok.forEach(c=>(c.r.mistakes||[]).forEach(m=>{if(m.kind!=='tip')cnt[m.type]=(cnt[m.type]||0)+1}));
  const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,3);
  return `<div class="aiins"><div><small>O‘rtacha</small><b>${esc(lvShort(lv))} · ${avg}/75</b><em>${ok.length} ta tekshiruv</em></div>
    <div><small>Eng zaif mezon</small><b>${esc(crit[0])}</b><em>o‘rtacha ${crit[1].toFixed(1)}/10</em></div>
    <div><small>Oxirgi natija</small><b>${aiPts(ok[0].r)}</b><em>${d==null?'birinchi tekshiruv':d>0?'▲ +'+d+' oldingisidan':d<0?'▼ '+d+' oldingisidan':'oldingisi bilan teng'}</em></div></div>
    ${top.length?`<p class="sub2" style="margin:0 0 6px">Ko‘p takrorlanadigan xatolaringiz — shularga e’tibor bering:</p><ul class="aitop">${top.map(([t,n])=>`<li>${esc(AI_MT[t]||t)} × ${n}</li>`).join('')}</ul>`:''}`;
}
function aiPage(){
  $('#ttl').textContent='AI Writing yordamchi';$('#sub').textContent='Multi-Level · Writing tekshiruvi';document.title='EDUNEST · AI Writing yordamchi';
  $('#back').textContent='← Bosh sahifa';$('#back').href='./#/me';$('#jump').hidden=true;$('#foot').hidden=true;
  const K=ST+'ai:'+UID;let D={};try{D=JSON.parse(ls(K)||'{}')}catch(e){}if(!AI_T[D.type])D.type='1.2';
  // a draft that was already checked is not brought back: the student starts clean (the result stays in "Mening natijalarim")
  if(D.lc&&String(D.text||'').trim()===D.lc){D.task='';D.text='';D.lc=''}
  const sv=()=>lset(K,JSON.stringify({type:D.type,task:D.task||'',text:D.text||'',lc:D.lc||''}));
  const clearAll=()=>{tk.value=tx.value='';D.task=D.text=D.lc='';sv();upd();host.innerHTML='';go.classList.remove('again');go.innerHTML=AI_ICON+' AI bilan tekshirish';tk.focus()};
  const desc={'1.1':'Do‘stga norasmiy xat · ~50 so‘z','1.2':'Rasmiy xat · 120–150 so‘z','2':'Esse / fikr bildirish · 180–200 so‘z'};
  const opts={onRewrite:()=>{tx.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>tx.focus({preventScroll:true}),350)},
    onAnother:()=>{clearAll();scrollTo({top:0,behavior:'smooth'})},
    anotherLabel:'Yangi topshiriq'};
  $('#main').innerHTML=`<div class="aip">
    <div class="aihero"><h1>AI Writing yordamchi</h1><p>Xat yoki esseingizni yozing — AI uni Multi-Level mezonlari bo‘yicha tekshiradi, har bir xatoni o‘zbekcha tushuntiradi va yaxshilangan variantini ko‘rsatadi.</p>
      <div class="feat"><span>Imtihon ballari: 15 · 20 · 40</span><span>5 mezon</span><span>Taxminiy daraja: B1 · B2 · C1</span><span>Xatolar + tushuntirish</span><span>Yaxshilangan variant</span></div></div>
    <div class="aistep"><h2><i>1</i>Topshiriq turi</h2><div class="aitypes">${['1.1','1.2','2'].map(k=>`<button type="button" data-ty="${k}" aria-pressed="${D.type===k}"><span class="tyh"><i class="tyl">${AI_T[k].lv}</i><em>${AI_T[k].max} ball</em></span><b>${k==='2'?'Part 2':'Task '+k}</b><small>${desc[k]}</small></button>`).join('')}</div></div>
    <div class="aistep"><h2><i>2</i>Topshiriq matni</h2><textarea class="tsk" id="atk" placeholder="Savolni yoki vaziyatni shu yerga yozing (masalan, kelgan xat va savol). AI javobingiz topshiriqqa mosligini shunga qarab tekshiradi."></textarea></div>
    <div class="aistep"><h2><i>3</i>Sizning javobingiz</h2><textarea class="ans" id="atx" placeholder="Javobingizni ingliz tilida yozing…" autocapitalize="sentences" spellcheck="false"></textarea>
      <div class="wbar"><span class="wc" id="awc">0 so‘z</span><span id="atg"></span><button type="button" class="aiclr" id="aclr">Tozalash</button></div>
      <button class="aib" type="button" id="ago">${AI_ICON} AI bilan tekshirish</button><div id="ares"></div></div>
    <div class="aistep" id="ahs" hidden><h2>Mening natijalarim</h2><div id="ain"></div><div class="aihist" id="ahl"></div></div>
    <p class="whint">Tekshirish uchun faqat topshiriq va javobingiz AI'ga yuboriladi (ismingiz emas). Natijalarni ustozingiz ham ko‘radi.</p></div>`;
  const tk=$('#atk'),tx=$('#atx'),host=$('#ares'),go=$('#ago');tk.value=D.task||'';tx.value=D.text||'';
  const upd=()=>{const t=AI_T[D.type],n=wcount(tx.value);$('#awc').textContent=n+' so‘z';$('#awc').classList.toggle('in',n>=t.lo&&n<=t.hi);$('#atg').textContent='Maqsad: '+t.lo+'–'+t.hi+' so‘z'};
  document.querySelectorAll('[data-ty]').forEach(b=>b.onclick=()=>{D.type=b.dataset.ty;document.querySelectorAll('[data-ty]').forEach(x=>x.setAttribute('aria-pressed',x===b));sv();upd()});
  tk.oninput=()=>{D.task=tk.value;sv()};tx.oninput=()=>{D.text=tx.value;sv();upd()};upd();
  $('#aclr').onclick=()=>{if((tk.value.trim()||tx.value.trim())&&wcount(tx.value)>15&&D.lc!==tx.value.trim()&&!confirm('Yozganlaringiz o‘chiriladi. Tozalaysizmi?'))return;clearAll()};
  go.onclick=async()=>{const text=tx.value.trim();
    if(wcount(text)<10){host.innerHTML=`<div class="aierr">${AI_ERR.short}</div>`;return}
    go.disabled=true;const stop=aiLoading(host);const j=await aiCheck(D.type,tk.value.trim(),text,'ai-page');stop();go.disabled=false;
    if(!j||!j.ok){host.innerHTML=`<div class="aierr">${esc(AI_ERR[j&&j.error]||AI_ERR.fail)}</div>`;return}
    D.lc=text;sv();aiResult(host,j.r,text,opts);go.classList.add('again');go.innerHTML=AI_ICON+' Tuzatib, qayta tekshirish';host.firstElementChild.scrollIntoView({behavior:'smooth',block:'start'});hist()};
  async function hist(){
    try{const ctl=new AbortController();setTimeout(()=>ctl.abort(),20000);
      const j=await (await fetch(CLOUD_URL+'?action=aihist&id='+encodeURIComponent(SESSION.id)+'&t='+encodeURIComponent(SESSION.t),{signal:ctl.signal})).json();
      if(!j||!j.ok)return;
      if(!j.on){go.disabled=true;if(!host.firstElementChild)host.innerHTML=`<div class="aierr">${AI_ERR.off}</div>`}
      j.checks=j.checks.filter(c=>!/^S/.test(c.type));   // speaking checks live on the speaking page
      if(!j.checks.length)return;$('#ahs').hidden=false;$('#ain').innerHTML=aiInsights(j.checks);
      $('#ahl').innerHTML=j.checks.map((c,i)=>`<button type="button" data-h="${i}"><span class="hl" style="background:${lvColor(c.level)}">${esc(lvShort(c.level))}</span><span class="hx"><b>${esc(AI_T[c.type]?AI_T[c.type].n:c.type)} · ${aiPts(c.r||{score75:c.score})}</b><small>${esc(new Date(c.at).toLocaleString())} · ${c.words} so‘z${c.task?' · '+esc(c.task.slice(0,60)):''}</small></span></button>`).join('');
      document.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{const c=j.checks[+b.dataset.h];if(!c.r)return;aiResult(host,c.r,c.text,opts);host.firstElementChild.scrollIntoView({behavior:'smooth',block:'start'})});
    }catch(e){}
  }
  hist();
}

/* ---------- mock exam: every part in one sitting ---------- */
const mmss=t=>{t=Math.max(0,Math.round(t));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')};
const allNums=()=>DOC.sections.flatMap(s=>Object.keys(s.ans).map(Number));
const partDone=s=>Object.keys(s.ans).filter(n=>norm(ANS[n])).length;
function ask(h,p,no,yes,f){const d=document.createElement('div');d.className='ov';d.innerHTML=`<div class="md" role="dialog" aria-modal="true"><h3>${esc(h)}</h3><p>${esc(p)}</p><div class="row2"><button id="ovn">${esc(no)}</button><button class="red" id="ovy">${esc(yes)}</button></div></div>`;document.body.appendChild(d);
  d.querySelector('#ovn').onclick=()=>d.remove();d.querySelector('#ovy').onclick=()=>{d.remove();f()};d.querySelector('#ovy').focus()}
function examBoot(){
  EX={t0:0,part:0,r:null,cfg:DOC.exam,tick:null,view:'intro'};document.body.classList.add('exam');
  let s=null;try{s=JSON.parse(ls(key())||'null')}catch(e){}
  if(s){ANS=s.a||{};EX.t0=s.t0||0;EX.part=Math.min(DOC.sections.length-1,s.part||0);EX.r=s.r||null}
  if(EX.r){examResult();return}
  if(EX.t0){if(Date.now()>=EX.t0+EX.cfg.mins*60000){examFinish(true);return}examGo(EX.part);return}
  examIntro();
}
function examIntro(){
  EX.view='intro';$('#ttl').textContent=DOC.short;$('#sub').textContent=DOC.title;document.title='EDUNEST · '+DOC.title;$('#foot').hidden=true;$('#jump').hidden=true;examBar();
  $('#main').innerHTML=`<div class="xin"><h2>${esc(DOC.title)}</h2><p class="sub">Haqiqiy imtihon formatida</p>
    <div class="facts"><div><b>${allNums().length}</b><span>savol</span></div><div><b>${DOC.sections.length}</b><span>qism</span></div><div><b>${EX.cfg.mins}</b><span>daqiqa</span></div></div>
    <ul><li>Barcha qismlar <b>bitta testda</b>: qismlar orasida xohlagancha o‘tishingiz mumkin.</li><li>Vaqt boshlangach <b>to‘xtamaydi</b>. Sahifani yopsangiz ham vaqt ketaveradi.</li><li>Javoblar faqat <b>oxirida</b> tekshiriladi: to‘g‘ri javoblar soni, ball va daraja chiqadi.</li><li>Tugatgach xaritada <b>sertifikat</b> ochiladi.</li></ul>
    <button class="xbtn" id="xgo">Testni boshlash</button></div>`;
  $('#xgo').onclick=()=>{EX.t0=Date.now();ANS={};save();examGo(0);scrollTo(0,0)};
}
function examBar(){
  let t=$('#xtabs');if(!t){t=document.createElement('div');t.id='xtabs';t.className='xtabs';$('.bar').after(t)}
  const live=EX.view==='part'||EX.view==='review';t.hidden=!live;
  if(!$('#xtm')){const m=document.createElement('span');m.id='xtm';m.className='xtm';$('.fs').before(m);$('.fs').classList.add('xhide')}
  $('#xtm').hidden=EX.view!=='part';
  if(!live)return;
  t.innerHTML=DOC.sections.map((s,i)=>{const of=Object.keys(s.ans).length,d=EX.r?Object.keys(s.ans).filter(n=>EX.r.res[n]).length:partDone(s);
    return `<button data-p="${i}" class="${i===EX.part?'on':''} ${!EX.r&&d===of?'full':''}" aria-label="${esc(s.label)}">${esc(s.label)}<small>${d}/${of}</small></button>`}).join('')+(EX.r?'':`<button class="xend" id="xend">Yakunlash</button>`);
  t.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{examGo(+b.dataset.p);scrollTo(0,0)});
  const e=$('#xend');if(e)e.onclick=examAsk;
  const on=t.querySelector('.on');if(on&&on.scrollIntoView)on.scrollIntoView({block:'nearest',inline:'center'});
}
function examGo(i){
  EX.part=i;EX.view=EX.r?'review':'part';SEC=DOC.sections[i];DONE=EX.r?{ok:Object.keys(SEC.ans).filter(n=>EX.r.res[n]).length,of:Object.keys(SEC.ans).length,res:EX.r.res}:null;armed=false;
  if(!EX.r)save();
  render();
  if(!EX.r&&!EX.tick)EX.tick=setInterval(examTick,500);examTick();
}
function examChrome(){$('#ttl').textContent=DOC.short;$('#sub').textContent=SEC.label+' · '+SEC.title;examBar()}
function examTick(){
  if(!EX||EX.r||!EX.t0)return;const left=(EX.t0+EX.cfg.mins*60000-Date.now())/1000;const m=$('#xtm');
  if(m){m.textContent=mmss(left);m.classList.toggle('low',left<300)}
  if(left<=0)examFinish(true);
}
function examFit(){const g=document.querySelector('.grid.split');if(!g)return;if(innerWidth<960){g.style.removeProperty('--xh');return}
  g.style.setProperty('--xh',Math.max(280,innerHeight-(g.getBoundingClientRect().top+scrollY)-96)+'px')}
addEventListener('resize',()=>{if(EX)examFit()});
function examFoot(){
  examFit();
  const f=$('#footin');$('#foot').hidden=false;const i=EX.part,last=i===DOC.sections.length-1;
  if(EX.r){f.innerHTML=`<button class="alt" id="xr">Natija</button><button id="dn">${H.a&&H.s!=null?'Bajardim':'Xaritaga qaytish'}</button>`;$('#xr').onclick=()=>{examResult();scrollTo(0,0)};$('#dn').onclick=goDone;return}
  const tot=allNums().length,a=allNums().filter(n=>norm(ANS[n])).length;
  f.innerHTML=`${i?'<button class="alt" id="xp">← Oldingi</button>':''}<button id="xn">${last?'Testni yakunlash':'Keyingi qism →'}<span class="cnt">${a} / ${tot} javob belgilandi</span></button>`;
  const p=$('#xp');if(p)p.onclick=()=>{examGo(i-1);scrollTo(0,0)};
  $('#xn').onclick=()=>{if(last)examAsk();else{examGo(i+1);scrollTo(0,0)}};
  const t=$('#xtabs');if(t)t.querySelectorAll('[data-p]').forEach((b,k)=>{const s=DOC.sections[k],of=Object.keys(s.ans).length,d=partDone(s);b.querySelector('small').textContent=d+'/'+of;b.classList.toggle('full',d===of)});
}
function examAsk(){const tot=allNums().length,a=allNums().filter(n=>norm(ANS[n])).length;
  ask('Testni yakunlaysizmi?',a<tot?`${tot-a} ta savol javobsiz qoldi. Yakunlagach javoblarni o‘zgartirib bo‘lmaydi.`:'Barcha savollarga javob berdingiz. Yakunlagach javoblarni o‘zgartirib bo‘lmaydi.','Davom etish','Yakunlash',()=>examFinish(false))}
function examFinish(auto){
  if(EX.tick){clearInterval(EX.tick);EX.tick=null}
  const res={};let ok=0;const per=DOC.sections.map(s=>{let k=0;Object.keys(s.ans).forEach(n=>{res[n]=isOk(ANS[n],s.ans[n]);if(res[n])k++});ok+=k;return{l:s.label,t:s.title,ok:k,of:Object.keys(s.ans).length}});
  const of=allNums().length,ball=EX.cfg.conv[ok],lv=(EX.cfg.levels.find(x=>ball>=x[0])||[0,''])[1];
  EX.r={ok,of,per,ball,lv,res,auto:!!auto,secs:Math.min(EX.cfg.mins*60,Math.round((Date.now()-EX.t0)/1000)),at:Date.now()};save();examResult();scrollTo(0,0);FEEL.play(lv?'success':'complete');
  const det=[];DOC.sections.forEach(s=>Object.keys(s.ans).map(Number).sort((a,b)=>a-b).forEach(n=>det.push([String(n),ANS[n]||'',res[n]?1:0,s.ans[n][0]])));
  sendRes(Object.assign(resBase(),{kind:'exam',sec:'exam',title:(DOC.title||DOC.short||'Mock test')+(auto?' · vaqt tugadi':''),ok,of,ball,lv,secs:EX.r.secs,per,det}));
}
function examResult(){
  EX.view='result';const r=EX.r;$('#ttl').textContent=DOC.short;$('#sub').textContent='Natija';$('#foot').hidden=true;$('#jump').hidden=true;examBar();
  $('#main').innerHTML=`<div class="xin xres"><h2>${r.auto?'Vaqt tugadi':'Test yakunlandi'}</h2><p class="sub">${esc(DOC.title)} · sarflangan vaqt ${mmss(r.secs)}</p>
    <div class="tiles"><div><b>${r.ok}/${r.of}</b><span>to‘g‘ri javob</span></div><div><b>${r.ball}</b><span>ball (75 dan)</span></div><div class="lv"><b>${r.lv||'—'}</b><span>${r.lv?'daraja':'B1 dan past'}</span></div></div>
    <table>${r.per.map(p=>`<tr><td>${esc(p.l)} · ${esc(p.t)}</td><td>${p.ok} / ${p.of}</td></tr>`).join('')}</table>
    <p class="lg">Ball jadvali: B1 38–50 · B2 51–64 · C1 65–75</p>
    <button class="xbtn" id="dn">${H.a&&H.s!=null?'Bajardim — sertifikatni olish':'Xaritaga qaytish'}</button>
    <button class="xbtn alt" id="xrev">Javoblarni ko‘rib chiqish</button>
    <button class="xbtn txt" id="xre">Qayta topshirish</button></div>`;
  $('#dn').onclick=goDone;$('#xrev').onclick=()=>{examGo(0);scrollTo(0,0)};
  $('#xre').onclick=()=>ask('Qayta topshirasizmi?','Hozirgi javoblaringiz va natijangiz o‘chadi, vaqt boshidan boshlanadi.','Bekor qilish','Qayta boshlash',()=>{ANS={};DONE=null;EX.t0=0;EX.part=0;EX.r=null;save();examIntro();scrollTo(0,0)});
}
function script(){
  let html=SEC.script.map(p=>esc(p)).join('</p><p>');
  if(SEC.marks){html=html.replace(/\[(\d{1,2})\]/g,'<mark class="qm"><b>$1</b></mark>');$('#scr').innerHTML=`<div class="script"><h2>Script</h2><p class="hint">Raqamli belgilar — javob aytilgan joy.</p><p>${html}</p></div>`;return}
  (SEC.hl||[]).forEach((h,i)=>{const e=esc(h);const at=html.indexOf(e);if(at>=0)html=html.slice(0,at)+`<mark><b>${9+i}</b>${e}</mark>`+html.slice(at+e.length)});
  $('#scr').innerHTML=`<div class="script"><h2>Script</h2><p>${html}</p></div>`;
}

/* ---------- audio ---------- */
async function player(){
  const pl=$('#pl');pl.innerHTML=`<div class="player"><div class="spin" style="width:30px;height:30px;margin:0;border-color:rgba(255,255,255,.25);border-top-color:#fff"></div><span class="lbl">Audio yuklanmoqda…</span></div>`;
  const direct=/\.mp3$/i.test(SEC.audio||'');
  try{
    if(!audioUrl||(direct&&audioUrl!==SEC.audio)){if(direct)audioUrl=SEC.audio;else{const raw=await load(SEC.audio);audioUrl=URL.createObjectURL(new Blob([raw],{type:'audio/mpeg'}))}}
  }catch(e){pl.innerHTML=`<div class="player"><span class="lbl">Audio yuklanmadi. Internetni tekshirib, sahifani yangilang.</span></div>`;return}
  // one audio object for the whole page: switching parts in a mock does not stop or restart it
  if(!window.AU||AU._src!==audioUrl){if(window.AU)AU.pause();window.AU=new Audio(audioUrl);AU._src=audioUrl;AU.preload=direct?'metadata':'auto'}
  const au=AU;
  const P='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',Pa='<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  pl.innerHTML=`<div class="player"><button class="pp" id="pp" aria-label="Ijro etish">${au.paused?P:Pa}</button><div class="pr"><input type="range" id="sb" min="0" max="1000" value="0" aria-label="Audio joyi"><div class="tm"><span id="t0">0:00</span><span id="t1">–:––</span></div></div><button class="sk" id="bk" aria-label="10 soniya orqaga">−10s</button></div>`;
  const f=t=>isFinite(t)?Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0'):'–:––';
  const tu=()=>{const a=$('#t0'),b=$('#sb');if(!a)return;a.textContent=f(au.currentTime);if(au.duration&&b)b.value=Math.round(au.currentTime/au.duration*1000)};
  au.onloadedmetadata=()=>{const t=$('#t1');if(t)t.textContent=f(au.duration)};au.ontimeupdate=tu;
  au.onplay=()=>{const b=$('#pp');if(b){b.innerHTML=Pa;b.setAttribute('aria-label','Pauza')}};
  au.onpause=()=>{const b=$('#pp');if(b){b.innerHTML=P;b.setAttribute('aria-label','Ijro etish')}};
  au.onerror=()=>{const l=$('#t1');if(l)l.textContent='xato'};
  if(au.duration)$('#t1').textContent=f(au.duration);tu();
  $('#pp').onclick=()=>au.paused?au.play():au.pause();
  $('#bk').onclick=()=>{au.currentTime=Math.max(0,au.currentTime-10)};
  $('#sb').oninput=e=>{if(au.duration)au.currentTime=e.target.value/1000*au.duration};
}

/* ---------- menu ---------- */
function menu(){
  $('#ttl').textContent=DOC.short;$('#sub').textContent=DOC.title;
  $('#main').innerHTML=`<div class="menu">${DOC.sections.map(s=>{let r=null;try{r=JSON.parse(ls(ST+'mashq:'+UID+':'+H.d+':'+s.id)||'null')}catch(e){}const d=r&&r.r;
    return `<a href="#d=${esc(H.d)}&x=${s.id}"><span class="num">${esc(s.label.replace(/\D/g,'')||'•')}</span><span>${esc(s.label)} · ${esc(s.title)}<small>${Object.keys(s.ans||{}).length?Object.keys(s.ans).length+' ta savol':s.kind==='study'?s.items.length+' ta '+esc(s.unit||'ibora'):s.kind==='write'?s.tasks.length+' ta topshiriq':s.kind==='note'?'o‘quv material':''}</small></span>${d?`<em>${d.ok}/${d.of}</em>`:''}</a>`}).join('')}</div>`;
}

let fs=+(ls(ST+'fs')||17);
function setFs(){document.documentElement.style.setProperty('--fs',fs+'px');lset(ST+'fs',fs)}
$('#fsp').onclick=()=>{fs=Math.min(24,fs+1);setFs()};$('#fsm').onclick=()=>{fs=Math.max(14,fs-1);setFs()};setFs();

async function boot(){
  if('speak' in H){if(!SESSION||!SESSION.t||SESSION.role==='teacher'){fail('Avval kiring','AI Speaking yordamchidan foydalanish uchun platformaga o‘quvchi sifatida kiring.');return}watermark();speakPage();return}
  if('ai' in H){if(!SESSION||!SESSION.t||SESSION.role==='teacher'){fail('Avval kiring','AI Writing yordamchidan foydalanish uchun platformaga o‘quvchi sifatida kiring.');return}watermark();aiPage();return}
  if(!H.d||!/^[a-z0-9-]+$/.test(H.d)){fail('Mashq topilmadi','Havola noto‘g‘ri. Xaritadan qayta oching.','./#/me');return}
  if(/^gr\d/.test(H.d)){location.replace('grammar.html'+location.hash);return}  /* grammar topics have their own page since 20.11.2026 (old map links keep working) */
  if(H.a)$('#back').href='./#/me/a/'+encodeURIComponent(H.a);
  if(!ls(ST+'k')){fail('Avval kiring','Bu mashq faqat EDUNEST o‘quvchilari uchun. Platformaga kiring va xaritadan oching.');return}
  try{DOC=await loadDoc(H.d)}
  catch(e){e.message==='net'?fail('Yuklanmadi','Internetni tekshirib, sahifani yangilang.','./#/me'):fail('Qayta kiring','Kirish muddati tugagan. Platformaga qaytadan kiring.');return}
  if(H.x==='all'&&DOC.exam){examBoot();return}
  SEC=DOC.sections.find(s=>s.id===H.x);
  if(!SEC){menu();return}
  restore();render();
}
addEventListener('hashchange',()=>location.reload());
/* sound, vibration and press feedback (FEEL, top of this script; 26.11.2026). AI Speaking and AI Writing keep exactly their own
   behaviour: no feedback on those pages (writing tasks switch it off in render()). Sounds wait while the listening audio plays and
   during a mock exam until its result (vibration still works). */
FEEL.init({ns:ST,off:('speak' in H)||('ai' in H),quiet:()=>!!(window.AU&&!window.AU.paused)||!!(EX&&EX.view!=='result')});
boot();
