
'use strict';
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

const PREVIEW=null;   /* the stand-alone preview file carries its tests and audio here; null on the platform */
const ST=PREVIEW?'edunest_lbdemo:':'edunest_mlb:';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lset=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const own=e=>/^(INPUT|TEXTAREA)$/.test((e&&e.tagName)||'');
/* protection, as in mashq.html */
document.addEventListener('contextmenu',e=>{if(!own(e.target))e.preventDefault()});
document.addEventListener('copy',e=>{if(!own(document.activeElement))e.preventDefault()});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&/^[spu]$/i.test(e.key))e.preventDefault()});

let SESSION=null;try{SESSION=JSON.parse(ls(ST+'session')||'null')}catch(e){}
const UID=PREVIEW?'namuna':(SESSION&&SESSION.id||'anon');
function who(){let p=null;try{p=JSON.parse(ls(ST+'p:'+UID)||'null')}catch(e){}const n=p&&p.student?p.student.name:'';return (n||'EDUNEST')+(p&&p.student&&p.student.id?' · '+p.student.id:'')}
function watermark(){const t=esc(who());const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='340' height='210'><text x='10' y='120' transform='rotate(-22 170 105)' font-family='Arial' font-size='15' font-weight='700' fill='rgba(20,27,45,0.05)'>${t}</text></svg>`;
  document.documentElement.style.setProperty('--wm',`url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`)}

/* ---------- address: #d=<doc>&x=<test>  (+ &a=<map>&s=<step>&sx=<the step's test> when opened from a map) ---------- */
const hp=()=>Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
let H=hp();
const DID=PREVIEW?PREVIEW.id:(H.d||'');
const STEP=!PREVIEW&&H.a&&H.s!=null&&H.s!==''?{a:H.a,s:+H.s,x:H.sx||H.x||''}:null;
const isStep=x=>!!STEP&&STEP.x===x;
function link(x){const p=new URLSearchParams();if(!PREVIEW)p.set('d',DID);if(x)p.set('x',x);if(STEP){p.set('a',STEP.a);p.set('s',String(STEP.s));if(STEP.x)p.set('sx',STEP.x)}return '#'+p.toString()}
function go(x){const h=link(x);if(location.hash===h||(h==='#'&&!location.hash)){H=hp();route()}else location.hash=h}
function goDone(){location.href='./#/me/a/'+encodeURIComponent(STEP.a)+'/done/'+STEP.s}
const mapHref=()=>STEP?'./#/me/a/'+encodeURIComponent(STEP.a):'./#/me';

/* the result of the test (stage A) goes to the teacher: queued in this browser, re-sent until the server has it (stored once per cid) */
const CLOUD_URL="https://tuffyskazbkbezsghgtk.supabase.co/functions/v1/api";
const RQ=ST+'rq:'+UID;let rqBusy=false;
const isStu=()=>!PREVIEW&&!!(SESSION&&SESSION.t&&SESSION.id&&SESSION.role!=='teacher');
async function rqFlush(){if(!isStu()||rqBusy)return;let q=[];try{q=JSON.parse(ls(RQ)||'[]')}catch(e){}if(!q.length)return;rqBusy=true;const sent=[];
  for(const b of q){try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),20000);
    const r=await fetch(CLOUD_URL,{method:'POST',body:JSON.stringify(Object.assign({},b,{action:'res',id:SESSION.id,t:SESSION.t,v:'ml'})),signal:ctl.signal});clearTimeout(t);
    const j=await r.json();if(j&&(j.ok||j.error==='bad'))sent.push(b.cid)}catch(e){}}
  let now=[];try{now=JSON.parse(ls(RQ)||'[]')}catch(e){}const left=now.filter(b=>!sent.includes(b.cid));
  if(left.length)lset(RQ,JSON.stringify(left));else try{localStorage.removeItem(RQ)}catch(e){}rqBusy=false}
function sendRes(b){if(!isStu())return;let q=[];try{q=JSON.parse(ls(RQ)||'[]')}catch(e){}
  b.cid=Date.now().toString(36)+Math.random().toString(36).slice(2,8);q.push(b);lset(RQ,JSON.stringify(q.slice(-40)));rqFlush()}
addEventListener('online',rqFlush);setTimeout(rqFlush,1500);

/* ---------- content: an encrypted <doc>.bin, as in mashq.html (the derived key is shared with it) ---------- */
async function sha8(s){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));return [...h.slice(0,4)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function decrypt(buf){
  const K=ls(ST+'k');if(!K)throw new Error('nokey');
  if(String.fromCharCode(...buf.slice(0,4))!=='EDN1')throw new Error('bad');
  const salt=buf.slice(4,20),sk=ST+'dk:'+(await sha8(K))+':'+btoa(String.fromCharCode(...salt));let key=null;
  try{const c=sessionStorage.getItem(sk);if(c)key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(c),x=>x.charCodeAt(0)),'AES-GCM',false,['decrypt'])}catch(e){}
  if(!key){
    const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(K),'PBKDF2',false,['deriveKey']);
    const k2=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,['decrypt']);
    try{sessionStorage.setItem(sk,btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw',k2)))))}catch(e){}
    key=k2}
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(20,32)},key,buf.slice(32)));
}
async function load(name){let r;try{r=await fetch(name+'.bin',{cache:'no-cache'})}catch(e){throw new Error('net')}if(!r.ok)throw new Error('net');return decrypt(new Uint8Array(await r.arrayBuffer()))}

/* ---------- small pieces ---------- */
const ICP={arr:'<path d="M5 12h14M13 6l6 6-6 6"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',x:'<path d="M6 6l12 12M18 6L6 18"/>',chev:'<path d="M6 9l6 6 6-6"/>',
  vol:'<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  play:'<path d="M8.5 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  head:'<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
  pen:'<path d="M4 20l1-4.2L16.3 4.5a2.1 2.1 0 0 1 3 3L8 18.9 4 20z"/><path d="M14.5 6.5l3 3"/>',
  target:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  msg:'<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 10h8M8 13h5"/>',
  bolt:'<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
  trophy:'<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  rep:'<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
  ban:'<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  flag:'<path d="M6 21V4"/><path d="M6 4h11l-2.2 4L17 12H6"/>',
  shuf:'<path d="M16 4h4v4"/><path d="M4 20L20 4"/><path d="M20 16v4h-4"/><path d="M14.5 14.5L20 20"/><path d="M4 4l5.5 5.5"/>',
  warn:'<path d="M12 4l9 15.5H3L12 4z"/><path d="M12 10v4.5M12 17.2v.2"/>',
  q:'<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.2c-.7.4-1.1 1-1.1 1.8M12 16.8v.2"/>',
  comp:'<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
  pin:'<path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
  up:'<path d="M5 16l5-5 3.5 3.5L19 9"/><path d="M14.5 9H19v4.5"/>',
  redo:'<path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  eye:'<path d="M3 3l18 18"/><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5.5 0 9 6 9 6a15.6 15.6 0 0 1-3 3.7M6.3 7.7A15.4 15.4 0 0 0 3 12s3.5 6 9 6a9 9 0 0 0 3.3-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>'};
const ic=n=>`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICP[n]}</svg>`;
const shuf=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const norm=s=>String(s||'').toLowerCase().replace(/[’‘`]/g,"'").replace(/^[\s"'.,;:!?()]+|[\s"'.,;:!?()]+$/g,'').replace(/\s+/g,' ');
const main=$('#main'),dock=$('#dock'),dockin=$('#dockin');
function toast(m){let d=$('#toast');if(!d){d=document.createElement('div');d.id='toast';d.className='toast';d.setAttribute('role','status');document.body.appendChild(d)}d.textContent=m;d.classList.add('on');clearTimeout(d._t);d._t=setTimeout(()=>d.classList.remove('on'),2800)}
function fail(h,p,back){stopAu();main.innerHTML=`<div class="msg"><h2>${esc(h)}</h2><p>${esc(p)}</p><a href="${back||'./#/login'}">${back?'Xaritaga qaytish':'Platformaga kirish'}</a></div>`;setDock('')}
function setBar(t,s){$('#ttl').textContent=t;$('#sub').textContent=s;document.title='EDUNEST · '+t}
function setBack(href,label){const b=$('#back');b.hidden=!href;if(href)b.setAttribute('href',href);$('#backt').textContent=label||'Orqaga'}
let TM=[];const later=(f,ms)=>{const id=setTimeout(f,ms);TM.push(id);return id};
function clearTimers(){TM.forEach(clearTimeout);TM=[]}
let LEAVE=null;   /* {h,p} while a timed stage runs: going back asks first (the stage itself is saved and continues later) */
function setDock(html){dock.hidden=!html;dockin.className='in';dockin.innerHTML=html||''}
function view(html,dk){stopAu();clearTimers();closeModal();const ts=$('#toast');if(ts)ts.classList.remove('on');main.innerHTML='<div class="vin">'+html+'</div>';setDock(dk);scrollTo(0,0)}
function pane(html){clearTimers();const p=$('#pane');p.classList.remove('pin');p.innerHTML=html;void p.offsetWidth;p.classList.add('pin');if(scrollY>8)scrollTo({top:0,behavior:'smooth'})}
function closeModal(){const m=$('#mbg');if(m)m.remove()}
function modal(h,p,btns){closeModal();const bg=document.createElement('div');bg.className='mbg';bg.id='mbg';
  bg.innerHTML=`<div class="mdl" role="dialog" aria-modal="true"><h3>${esc(h)}</h3><p>${esc(p)}</p><div class="mb">${btns.map((b,i)=>`<button type="button" class="btn ${b.cls||''}" data-i="${i}">${esc(b.t)}</button>`).join('')}</div></div>`;
  document.body.appendChild(bg);bg.onclick=e=>{if(e.target===bg)closeModal()};
  bg.querySelectorAll('button').forEach(x=>x.onclick=()=>{closeModal();const f=btns[+x.dataset.i].f;if(f)f()});
  const f=bg.querySelector('.btn.pri')||bg.querySelector('.btn');if(f)f.focus()}
$('#back').addEventListener('click',e=>{if(!LEAVE)return;e.preventDefault();const href=$('#back').getAttribute('href');
  modal(LEAVE.h,LEAVE.p,[{t:'Chiqish',f:()=>{LEAVE=null;stopAu();if(href.charAt(0)==='#'){if(location.hash===href){H=hp();route()}else location.hash=href}else location.href=href}},{t:'Davom etish',cls:'pri'}])});
function confetti(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const c=document.createElement('canvas');c.className='cf';document.body.appendChild(c);
  const d=Math.min(2,devicePixelRatio||1),W=c.width=innerWidth*d,Hh=c.height=innerHeight*d,x=c.getContext('2d'),cols=['#E3101F','#6B3FE0','#0E8A4F','#F2B705','#FFFFFF','#9D7FF5'];
  const ps=Array.from({length:90},()=>({x:W/2+(Math.random()-.5)*W*.3,y:Hh*.3,vx:(Math.random()-.5)*14*d,vy:(-Math.random()*13-4)*d,s:(5+Math.random()*6)*d,r:Math.random()*6,vr:(Math.random()-.5)*.4,c:cols[Math.random()*cols.length|0]}));
  const t0=performance.now();(function f(n){const el=n-t0;x.clearRect(0,0,W,Hh);ps.forEach(p=>{p.vy+=.34*d;p.x+=p.vx;p.y+=p.vy;p.vx*=.99;p.r+=p.vr;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.globalAlpha=Math.max(0,1-el/1900);x.fillStyle=p.c;x.fillRect(-p.s/2,-p.s/3,p.s,p.s*.66);x.restore()});if(el<1900)requestAnimationFrame(f);else c.remove()})(t0)}

/* saved on this device, under the same key shape as mashq.html, so the map's "Bajardim" check (stepProof) reads it:
   {n: attempt, run: a timed stage in progress, a, b, c, d, e: the finished stages, r: {ok, of, inf} when the whole test is done} */
const skey=x=>ST+'mashq:'+UID+':'+DID+':'+x;
function sget(x){try{const o=JSON.parse(ls(skey(x))||'null');return o&&typeof o==='object'?o:{}}catch(e){return {}}}
function sput(x,o){lset(skey(x),JSON.stringify(o))}

/* ---------- audio: one player for the whole page (phones allow that after the first tap); the 8 clips of a test are
   fetched before the test starts, so nothing waits for the network between two sentences ---------- */
const AU=new Audio();AU.preload='auto';
const AUD=new Map();let AUP=false,auTok=0,auRaf=0,auDog=0;
const akey=(t,it)=>t.src+'-'+it.n;
function stopAu(){auTok++;AUP=false;cancelAnimationFrame(auRaf);clearTimeout(auDog);AU.onended=AU.ontimeupdate=AU.onerror=null;try{AU.pause()}catch(e){}}
function playAu(k,o){o=o||{};stopAu();const tok=auTok,from=o.from||0,seek=()=>{try{if(Math.abs(AU.currentTime-from)>.05)AU.currentTime=from}catch(e){}};
  if(AU._k!==k){AU.src=AUD.get(k);AU._k=k}seek();   /* o.from / o.until: a part of a longer clip (the talk of a Part 2 test) */
  let fin=false;
  const end=()=>{if(fin||tok!==auTok)return;fin=true;AUP=false;cancelAnimationFrame(auRaf);clearTimeout(auDog);AU.onended=AU.ontimeupdate=AU.onerror=null;try{AU.pause()}catch(e){}if(o.end)o.end()};
  const blocked=()=>{if(fin||tok!==auTok)return;fin=true;AUP=false;cancelAnimationFrame(auRaf);clearTimeout(auDog);if(o.blocked)o.blocked()};
  const loop=()=>{if(fin||tok!==auTok)return;const c=AU.currentTime;if(o.tick)o.tick(c);if(o.until&&c>=o.until){end();return}auRaf=requestAnimationFrame(loop)};
  AU.onended=end;AU.onerror=blocked;AU.ontimeupdate=()=>{if(o.until&&AU.currentTime>=o.until)end()};
  AUP=true;
  const run=()=>{if(fin||tok!==auTok)return;if(from&&AU.currentTime<from-.3)seek();auRaf=requestAnimationFrame(loop);auDog=setTimeout(end,((o.until?o.until-from:o.len||30)+3)*1000)};   /* a safety net: the stage always moves on */
  let p;try{p=AU.play()}catch(e){blocked();return}
  if(p&&p.then)p.then(run,e=>{if(e&&e.name==='AbortError')return;blocked()});else run()}
async function ensureAudio(t,onp){const all=ENG[DOC.kind].keys(t),need=all.filter(k=>!AUD.has(k));let done=all.length-need.length;if(onp)onp(done,all.length);
  await Promise.all(need.map(async k=>{const r=await fetch('audio/'+DID+'-'+k+'.mp3');if(!r.ok)throw new Error('net');const b=await r.blob();
    AUD.set(k,URL.createObjectURL(b.type?b:new Blob([b],{type:'audio/mpeg'})));done++;if(onp)onp(done,all.length)}))}
/* a soft two-note chime made here (no file): the sound check, and it wakes the phone's player inside the tap */
let CHIME=null;
function chime(){if(!CHIME){const sr=22050,n=Math.floor(sr*.95),b=new DataView(new ArrayBuffer(44+n*2)),w=(o,s)=>{for(let i=0;i<s.length;i++)b.setUint8(o+i,s.charCodeAt(i))};
    w(0,'RIFF');b.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,1,true);b.setUint32(24,sr,true);b.setUint32(28,sr*2,true);b.setUint16(32,2,true);b.setUint16(34,16,true);w(36,'data');b.setUint32(40,n*2,true);
    const e=(f,t,t0)=>t<t0?0:Math.sin(2*Math.PI*f*(t-t0))*Math.exp(-(t-t0)*5)*Math.min(1,(t-t0)*220);
    for(let i=0;i<n;i++){const t=i/sr;b.setInt16(44+i*2,Math.round(8500*(e(659.26,t,0)+e(987.77,t,.17)+.6*e(1318.51,t,.34))),true)}
    CHIME=URL.createObjectURL(new Blob([b.buffer],{type:'audio/wav'}));AUD.set('~chime',CHIME)}
  playAu('~chime',{len:1})}

/* ---------- shared parts of the stages ---------- */
const ENG={};   /* one engine per booster kind (the doc's `kind`): {stg, of, intro, avg, how, keys(t), state(t), open(t)} */
const STG=[['A','Test','head'],['B','Eshitib yozing','pen'],['C','Gapning maqsadi','target'],['D','Iboralar','msg'],['E','Tezkor raund','bolt']];
function stepper(step){const S=ENG[DOC.kind].stg,c=S.findIndex(s=>s[0]===step);
  return `<ol class="stp" aria-label="Bosqichlar">${S.map(([k,l],o)=>`<li class="${o<c?'done':o===c?'on':''}"${o===c?' aria-current="step"':''}><i>${o<c?ic('check'):k}</i><span>${l}</span></li>`).join('')}</ol>`}
const help=(icon,html,en)=>`<div class="help"><span class="hi">${ic(icon)}</span><div>${html}<small>${en}</small></div></div>`;
function bars(pk,n){const m=pk.length/n;let h='';for(let i=0;i<n;i++){let v=0;for(let j=Math.floor(i*m);j<Math.max(Math.floor((i+1)*m),Math.floor(i*m)+1);j++)v=Math.max(v,+pk[j]||0);h+=`<i style="--h:${Math.round(10+v*10)}%"></i>`}return h}
/* o: {n, of, it, two: both readings (the test), replay: a button to listen again (B, C), lab: the counter's word} */
function stageCard(o){const it=o.it;return `<section class="stage" id="stage" data-ph="0" aria-label="Audio">
  <div class="sg-top"><b>${o.lab||'Gap'} ${o.n} <em>/ ${o.of}</em></b><div class="segs" aria-hidden="true">${Array.from({length:o.of},(_,k)=>`<i class="${k<o.n-1?'d':k===o.n-1?'c':''}"></i>`).join('')}</div></div>
  <div class="trks ${o.two?'two':'one'}">${o.replay?`<button type="button" class="pbtn" id="rp" aria-label="Tinglash">${ic('play')}</button>`:''}
    <div class="trk" id="tk1"><div class="wv">${bars(it.pk[0],o.two?28:48)}</div>${o.two?'<small>1-marta</small>':''}</div>
    ${o.two?`<div class="mid" aria-hidden="true"><i></i><i></i><i></i></div><div class="trk" id="tk2"><div class="wv">${bars(it.pk[1],28)}</div><small>2-marta</small></div>`:''}</div>
  <div class="sg-foot"><span class="live"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span id="sgt" aria-live="polite"></span></span>
    <span class="cd" id="cd" hidden><svg viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="19"/><circle cx="23" cy="23" r="19" class="cdr" id="cdr"/></svg><b id="cdn"></b></span></div>
  <button type="button" class="tapplay" id="tap" hidden>${ic('play')} Tinglash uchun bosing</button>
</section>`}
function paint(id,p){const el=document.getElementById(id);if(!el)return;const bs=el.firstElementChild.children,n=Math.max(0,Math.min(bs.length,Math.round(p*bs.length)));if(el._n===n)return;el._n=n;for(let i=0;i<bs.length;i++)bs[i].classList.toggle('on',i<n)}
/* plays one sentence into the stage card. o: {two, txt: fixed status line while it plays, end} */
function playItem(t,it,o){const sg=$('#stage');if(!sg)return;const s1=Math.max(.3,it.cut-.2),d2=Math.max(.3,it.dur-it.s2+.1);
  const set=(ph,txt)=>{if(sg.dataset.ph!==ph){sg.dataset.ph=ph;const s=$('#sgt');if(s&&txt!=null)s.textContent=txt}};
  const start=()=>{const tp=$('#tap');if(tp)tp.hidden=true;sg.classList.add('play');paint('tk1',0);if(o.two)paint('tk2',0);sg.dataset.ph='0';
    playAu(akey(t,it),{until:o.two?0:it.cut,len:o.two?it.dur:it.cut,
      tick:c=>{if(!sg.isConnected)return;
        if(!o.two){set('1',o.txt!=null?o.txt:'Tinglang');paint('tk1',c/s1);return}
        if(c<it.cut){set('1','Tinglang · 1-marta');paint('tk1',c/s1)}else if(c<it.s2-.1){paint('tk1',1);set('p','Pauza')}else{paint('tk1',1);set('2','Tinglang · 2-marta');paint('tk2',(c-it.s2+.1)/d2)}},
      end:()=>{if(!sg.isConnected)return;sg.classList.remove('play');paint('tk1',1);if(o.two)paint('tk2',1);set('e',o.txt!=null?o.txt:'Tugadi');if(o.end)o.end()},
      blocked:()=>{if(!sg.isConnected)return;sg.classList.remove('play');const tp=$('#tap');if(tp){tp.hidden=false;tp.onclick=start}}})};
  start()}
/* the answer time after the audio: a ring that runs out */
function countdown(sec,onEnd,label){const cd=$('#cd'),sg=$('#stage');if(!cd||!sg)return;cd.hidden=false;sg.dataset.ph='c';$('#sgt').textContent=label;
  const r=$('#cdr');r.style.animation='none';void r.getBoundingClientRect();r.style.animation=`cdrun ${sec}s linear forwards`;
  const t1=performance.now();(function tick(){const n=$('#cdn');if(!n||!cd.isConnected)return;const left=sec*1000-(performance.now()-t1);n.textContent=Math.max(0,Math.ceil(left/1000));cd.classList.toggle('hot',left<=2000);
    if(left<=0){onEnd();return}later(tick,100)})()}
const optsHTML=ops=>`<div class="opts" id="opts" role="group" aria-label="Javoblar">${ops.map(([v,badge,text],j)=>`<button type="button" class="opt" data-v="${esc(v)}" style="--i:${j}"><i>${esc(badge)}</i><span>${esc(text)}</span></button>`).join('')}</div>`;
function ring(v,max,col){const r=54,c=2*Math.PI*r,p=max?v/max:0;return `<svg viewBox="0 0 132 132" aria-hidden="true"><circle class="tr" cx="66" cy="66" r="${r}"/><circle class="rg" cx="66" cy="66" r="${r}" stroke="${col}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-o="${c*(1-p)}"/></svg>`}
const anim=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{$$('.rg').forEach(e=>e.style.strokeDashoffset=e.dataset.o);$$('.sb .col i').forEach(e=>e.style.height=e.dataset.h)}));
const col=(v,m)=>v/m>=.75?'#0E8A4F':v/m>=.5?'#D98A06':'#E3101F';
const replyOf=it=>it.o.find(o=>o[0]===it.k)[1];
const textOf=(it,L)=>{const f=it.o.find(o=>o[0]===L);return f?L+') '+f[1]:''};
/* prepares the audio of a test for a start button: #go waits (and shows why) until the 8 clips are here */
function prep(t,ready){const b=$('#go'),l=$('#ld');if(!b)return;b.disabled=true;
  ensureAudio(t,(a,n)=>{if(l&&l.isConnected&&a<n)l.textContent=`Audio yuklanmoqda… ${a}/${n}`}).then(()=>{if(!b.isConnected)return;b.disabled=false;ready()},
    ()=>{if(!b.isConnected)return;l.textContent='Audio yuklanmadi. Internetni tekshiring.';b.disabled=false;b._retry=true;b.innerHTML=ic('redo')+' Qayta urinish'})}

/* ================= booster home: the tests ================= */
let DOC=null;
const f1=v=>v==null?'—':String(Math.round(v*10)/10).replace('.',',');
function testState(t){const d=sget(t.id);
  if(d.done)return{k:'done',st:`Bajarilgan · Test ${d.a.ok}/8 → Tezkor raund ${d.e.ok}/8`,go:'Hisobot',n:5};
  if(d.a){const n=d.e?5:d.d?4:d.c?3:d.b?2:1;return{k:'run',st:`Davom etmoqda: Test ${d.a.ok}/8 bajarildi, ${d.d?'E bosqich qoldi':d.c?'D bosqichdan davom eting':d.b?'C bosqichdan davom eting':'B bosqichdan davom eting'}`,go:'Davom ettirish',n}}
  if(d.run&&d.run.s==='A')return{k:'run',st:`Test boshlangan: ${d.run.i+1}-gapdan davom etasiz`,go:'Davom ettirish',n:0};
  return{k:'new',st:'Yangi · 8 ta gap · taxminan 12 daqiqa',go:'Boshlash',n:0}}
function hub(){LEAVE=null;setBar(DOC.title,PREVIEW?'Namuna · '+DOC.tests.length+' ta test':"EDUNEST · A'zamjon Toxirov");setBack(PREVIEW?'':mapHref(),STEP?'Xarita':'Orqaga');
  const E=ENG[DOC.kind],ds=DOC.tests.map(t=>sget(t.id)).filter(d=>d.done),avg=k=>ds.length?ds.reduce((s,d)=>s+d[k].ok,0)/ds.length:null;
  view(`<section class="hero"><div class="dec" aria-hidden="true">${[30,55,80,45,100,70,38,62,90,50,28,66,84,42].map(h=>`<i style="--h:${h}%"></i>`).join('')}</div>
      <span class="eb">Multi-Level · Listening</span><h1>${esc(DOC.title)}</h1>
      <p>${E.intro}</p>
      <div class="hstats"><div><b>${ds.length}/${DOC.tests.length}</b><span>test bajarildi</span></div><div><b>${f1(avg('a'))}${ds.length?'/'+E.of:''}</b><span>o‘rtacha Test</span></div><div><b>${f1(avg('e'))}${ds.length?'/'+E.of:''}</b><span>o‘rtacha Tezkor raund</span></div></div></section>
    ${PREVIEW?`<div class="note"><b>Bu ko‘rib chiqish uchun namuna (${DOC.tests.length} ta test).</b> Natijalar faqat shu qurilmada saqlanadi. Platformada XP, xarita va ustoz hisoboti ham bo‘ladi.</div>`:''}
    <h2 class="sech">Testlar</h2>
    <div class="tl">${(()=>{const sts=DOC.tests.map(E.state),nxt=sts.findIndex(s=>s.k!=='done');return DOC.tests.map((t,q)=>{const s=sts[q];return `<button type="button" class="tc ${s.k}${q===nxt?' next':''}" data-t="${t.id}"><span class="no">${s.k==='done'?ic('check'):String(t.n).padStart(2,'0')}</span>
      <span class="tx"><small>Test ${t.n}</small><b>${esc(t.mock)}</b><span>${esc(s.st)}</span><span class="pd" aria-hidden="true">${E.stg.map((_,j)=>`<i class="${j<s.n?'d':j===s.n&&s.k==='run'?'c':''}"></i>`).join('')}</span></span>
      <span class="go"><span>${s.go}</span>${ic('arr')}</span></button>`}).join('')})()}</div>
    <h2 class="sech">Har bir testda 5 bosqich</h2>
    <ol class="how">${E.stg.map(([k,l,icn],j)=>`
      <li><span class="hi">${ic(icn)}</span><div><b><em>${k}</em>${l}</b><span>${E.how[j]}</span></div></li>`).join('')}
    </ol>
    ${PREVIEW?`<p style="margin:18px 4px 0;font-size:13.5px;color:var(--slate)">Sinab ko‘rgach natijalarni o‘chirish: <button type="button" class="btn sm" id="wipe">Hammasini tozalash</button></p>`:''}`,'');
  $$('[data-t]').forEach(b=>b.onclick=()=>{FEEL.play('open');go(b.dataset.t)});
  const w=$('#wipe');if(w)w.onclick=()=>modal('Natijalar o‘chadi','Shu qurilmadagi barcha natijalar o‘chadi. Davom etasizmi?',[{t:'Bekor qilish'},{t:'Tozalash',cls:'pri',f:()=>{DOC.tests.forEach(t=>{try{localStorage.removeItem(skey(t.id))}catch(e){}});hub()}}])}
function openTest(t){setBar(DOC.title,'Test '+t.n+' · '+t.mock);
  if(isStep(t.id))setBack(mapHref(),'Xarita');else setBack(link(''),'Testlar');
  ENG[DOC.kind].open(t)}
/* tap-to-match table, shared by the boosters (Part 1: phrases and their meaning; Part 2: the notes' words and the speaker's).
   o: {step, rows:[[left, right]], help, bank, pick, done(first, of), nextLabel, next} */
function matchStage(t,o){const rows=o.rows,n=rows.length,k={placed:Array(n).fill(null),locked:Array(n).fill(false),rev:Array(n).fill(false),checks:0,first:null,chip:null,row:null,order:shuf([...Array(n).keys()])};LEAVE=null;
  view(`${stepper(o.step)}${o.help}
    <div class="mt" id="rows"></div><div class="bank"><div class="bh"><b>${o.bank}</b><span id="hint"></span></div><div class="chips" id="chips"></div></div>`,
    `<button type="button" class="btn" id="rev" hidden>Javoblarni ko‘rsatish</button><div class="dk-l"></div><button type="button" class="btn pri" id="ck">Tekshirish</button>`);
  const draw=()=>{
    $('#rows').innerHTML=rows.map((r,i)=>{const p=k.placed[i],cls=k.rev[i]?'rev':k.locked[i]?'ok':p!=null?'full':k.row===i?'sel':'';
      return `<div class="mr"><span class="i">${i+1}</span><div class="l">${esc(r[0])}</div><button type="button" class="slot ${cls}" data-i="${i}">${p!=null?esc(rows[p][1]):k.chip!=null?'shu yerga':'bo‘sh'}</button></div>`}).join('');
    const used=new Set(k.placed.filter(x=>x!=null));
    $('#chips').innerHTML=k.order.map(j=>`<button type="button" class="chip ${used.has(j)?'used':''} ${k.chip===j?'sel':''}" data-j="${j}">${esc(rows[j][1])}</button>`).join('');
    $('#hint').textContent=k.locked.every(Boolean)?'':used.size===n?'Hammasi joylandi: «Tekshirish»ni bosing':k.chip!=null?'Endi bo‘sh katakni bosing':o.pick;
    $('.bank').classList.toggle('full',used.size===n);
    $$('.chip').forEach(c=>c.onclick=()=>{const j=+c.dataset.j;if(used.has(j))return;if(k.row!=null){k.placed[k.row]=j;k.row=null;k.chip=null}else k.chip=k.chip===j?null:j;draw()});
    $$('.slot').forEach(s=>s.onclick=()=>{const i=+s.dataset.i;if(k.locked[i])return;if(k.placed[i]!=null){k.placed[i]=null;k.row=null}else if(k.chip!=null){k.placed[i]=k.chip;k.chip=null}else k.row=k.row===i?null:i;draw()})};
  const finish=()=>{o.done(k.first==null?0:k.first,n);const b=$('#ck');b.innerHTML=o.nextLabel+' '+ic('arr');b.onclick=o.next;$('#rev').hidden=true;
    FEEL.play(k.first===n?'success':'complete');toast(k.first===n?'Mukammal!':'Bajarildi')};
  $('#ck').onclick=()=>{if(k.placed.some(p=>p==null)){FEEL.play('warn');toast('Avval hamma katakni to‘ldiring');return}k.checks++;const wrong=[];let right=0;
    k.placed.forEach((p,i)=>{if(k.locked[i])return;if(p===i){k.locked[i]=true;right++}else{wrong.push(i);k.placed[i]=null}});if(k.first==null)k.first=right;draw();
    wrong.forEach(i=>{const s=document.querySelector(`.slot[data-i="${i}"]`);if(s)s.classList.add('shake')});
    if(k.locked.every(Boolean)){finish();return}FEEL.play('wrong');toast(`${n-wrong.length}/${n} to‘g‘ri. Qolganlarini qayta urinib ko‘ring`);if(k.checks>=2)$('#rev').hidden=false};
  $('#rev').onclick=()=>{rows.forEach((r,i)=>{if(!k.locked[i]){k.placed[i]=i;k.locked[i]=true;k.rev[i]=true}});draw();finish()};
  draw()}

/* ======================================================================================================================
   LISTENING PART 1 BOOSTER (doc kind lb1): 8 sentences, each with three replies
   ====================================================================================================================== */
ENG.lb1={stg:STG,of:8,keys:t=>t.items.map(it=>akey(t,it)),state:testState,
  intro:'Gapni eshitasiz va unga mos javobni tanlaysiz. Bu shunchaki mashq emas: har bir testdan keyin nega xato qilganingizni tushunasiz va xuddi shu gaplarni yana to‘rt xil usulda ishlaysiz.',
  how:['Imtihondagidek: 8 ta gap, har biri ikki marta o‘qiladi, bitta urinish. Keyin har bir javob tahlili va tuzoqlar.',
    'Gapni qayta tinglab, tushib qolgan so‘zni yozasiz. Quloq aniq eshitishga o‘rganadi.',
    'Matnsiz, faqat eshitib: so‘zlovchi nima qilyapti? Shundan qanday javob kerakligi ma’lum bo‘ladi.',
    'Testdagi tayyor javob iboralarini o‘zbekcha ma’nosi bilan juftlaysiz va daftarga ko‘chirasiz.',
    'O‘sha 8 ta gap, lekin bir marta o‘qiladi, javoblar aralashgan, 5 soniya vaqt. A bosqich bilan solishtirasiz.'],
  open(t){const d=sget(t.id);if(d.done)report(t,false);else if(!d.a)stageA(t);else if(!d.b)resA(t);else if(!d.c)stageC(t);else if(!d.d)stageD(t);else if(!d.e)stageE(t);else report(t,false)}};

/* ================= A · the test, like the exam ================= */
function stageA(t){const d=sget(t.id),run=d.run&&d.run.s==='A'?d.run:null;LEAVE=null;
  view(`${stepper('A')}<section class="card cover"><span class="eb">Test ${t.n} · 8 ta gap · taxminan 3 daqiqa</span><h2>${esc(t.mock)} · Part 1</h2>
    <p class="q">You will hear some sentences. You will hear each sentence twice. Choose the correct reply to each sentence (A, B, or C).</p>
    <ul class="rules"><li><span class="ri">${ic('rep')}</span><span>Har bir gap <b>ikki marta</b> o‘qiladi, xuddi imtihondagidek</span></li>
      <li><span class="ri">${ic('ban')}</span><span>Audioni to‘xtatib yoki qayta qo‘yib bo‘lmaydi</span></li>
      <li><span class="ri">${ic('clock')}</span><span>Gap tugagach javob uchun <b>6 soniya</b> beriladi</span></li>
      <li><span class="ri">${ic('flag')}</span><span>Bitta urinish: oxirida javoblar va tahlilni ko‘rasiz</span></li></ul>
    <div class="sndchk"><button type="button" class="btn sm" id="chk">${ic('vol')} Ovozni tekshirish</button><span>Ovoz eshitilmasa, qurilma ovozini balandlating.</span></div></section>`,
    `<div class="dk-l" id="ld">Audio yuklanmoqda…</div><button type="button" class="btn pri" id="go" disabled>${run?'Davom ettirish':'Boshlash'} ${ic('arr')}</button>`);
  $('#chk').onclick=chime;
  const ready=()=>{$('#ld').innerHTML=run?`<b>${run.i+1}</b>-gapdan davom etasiz`:'<b>8</b> ta gap · audio tayyor'};
  $('#go').onclick=()=>{const b=$('#go');if(b._retry){b._retry=false;b.innerHTML=(run?'Davom ettirish':'Boshlash')+' '+ic('arr');prep(t,ready);return}runA(t,run)};
  prep(t,ready)}
function runA(t,run){
  const st=run?{i:Math.min(7,run.i|0),ans:run.ans.slice(0,8),acc:run.acc||0,ex:(run.ex||0)+1}:{i:0,ans:Array(8).fill(''),acc:0,ex:0};let seg0=Date.now();
  const keep=()=>{st.acc+=Date.now()-seg0;seg0=Date.now();const d=sget(t.id);d.run={s:'A',i:st.i,ans:st.ans,acc:st.acc,ex:st.ex};sput(t.id,d)};
  LEAVE={h:'Test tugamagan',p:'Chiqsangiz, keyingi safar shu gapdan davom etasiz.'};
  view(`${stepper('A')}<div id="pane"></div>`,`<div class="dk-l"><b id="dkn">${st.ans.filter(Boolean).length}</b> / 8 javob</div><button type="button" class="btn pri" id="nx" disabled></button>`);
  const nx=$('#nx');
  const next=()=>{st.i++;if(st.i>=8){finish();return}draw()};
  nx.onclick=next;
  function draw(){keep();const it=t.items[st.i];
    pane(stageCard({n:st.i+1,of:8,it,two:true})+optsHTML(it.o.map(([L,x])=>[L,L,x])));
    nx.disabled=!st.ans[st.i];nx.innerHTML=(st.i<7?'Keyingi gap':'Testni tugatish')+' '+ic('arr');
    $$('.opt').forEach(b=>{if(b.dataset.v===st.ans[st.i])b.classList.add('sel');
      b.onclick=()=>{st.ans[st.i]=b.dataset.v;$$('.opt').forEach(x=>x.classList.toggle('sel',x===b));nx.disabled=false;$('#dkn').textContent=st.ans.filter(Boolean).length;keep()}});
    playItem(t,it,{two:true,end:()=>countdown(6,next,'Javobni tanlang')})}
  function finish(){LEAVE=null;st.acc+=Date.now()-seg0;const ok=st.ans.filter((a,i)=>a===t.items[i].k).length;const d=sget(t.id);delete d.run;
    d.n=d.n||1;d.a={ans:st.ans,ok,secs:Math.max(1,Math.round(st.acc/1000)),ex:st.ex,at:Date.now()};sput(t.id,d);
    sendRes({kind:'ex',doc:DID,sec:t.id,aid:isStep(t.id)?STEP.a:'',step:isStep(t.id)?STEP.s:null,title:DOC.title+' · Test '+t.n+(d.n>1?' · '+d.n+'-urinish':''),ok,of:8,secs:d.a.secs,
      det:t.items.map((it,i)=>[String(i+1),textOf(it,st.ans[i]),st.ans[i]===it.k?1:0,textOf(it,it.k)])});
    resA(t,true)}
  draw()}
function trapsOf(t,ans){const c={};ans.forEach((a,i)=>{const it=t.items[i];if(a===it.k)return;const k=a?it.traps[a][0]:'blank';c[k]=(c[k]||0)+1});return c}
function tipsA(t,r){const f=[],c=trapsOf(t,r.ans);
  f.push(r.ok===8?['trophy','A’lo! Hamma javob to‘g‘ri.']:r.ok>=6?['check','Yaxshi! Xato javoblardagi tuzoqlarni pastda ko‘rib chiqing.']:['pin','Bu test qiyin bo‘ldi. Pastda har bir gapni qayta tinglab, tahlilini o‘qing.']);
  if(c.soz)f.push(['warn','So‘z tuzog‘i: gapdagi so‘z javobda takrorlansa, ehtiyot bo‘ling. Ko‘pincha bu tuzoq.']);
  if(c.savol)f.push(['q','Avval gapning maqsadini aniqlang: When → vaqt, Why → sabab, Did you → Ha yoki Yo‘q.']);
  if(c.zamon)f.push(['clock','Zamon va shaxsga qarang: Did you …? → I did / I didn’t. They → they.']);
  if(c.mantiq)f.push(['comp','Vaziyatni tasavvur qiling: kim kimga, qayerda gapiryapti?']);
  if(c.blank)f.push(['ban','Hech qachon javobsiz qoldirmang: taxmin ham to‘g‘ri chiqishi mumkin.']);
  return f}
function resA(t,fresh,back){const r=sget(t.id).a,c=trapsOf(t,r.ans),nt=Object.keys(c).filter(k=>k!=='blank').reduce((s,k)=>s+c[k],0);LEAVE=null;
  view(`${back?'':stepper('A')}<section class="card"><div class="res"><div class="ring">${ring(r.ok,8,col(r.ok,8))}<div><b>${r.ok}/8</b><small>to‘g‘ri</small></div></div>
      <div><div class="mini"><div><b>${Math.round(r.ok/8*100)}%</b><span>aniqlik</span></div><div><b>${nt}</b><span>tuzoqqa tushish</span></div><div><b>${c.blank||0}</b><span>javobsiz</span></div></div></div></div>
      <ul class="tips">${tipsA(t,r).map(f=>`<li><span class="hi">${ic(f[0])}</span><span>${f[1]}</span></li>`).join('')}</ul></section>
    <h2 class="sech">Javoblar va tahlil<button type="button" class="tgl" id="tgl">Hammasini ochish</button></h2>
    <div>${t.items.map((it,i)=>{const a=r.ans[i],good=a===it.k;return `<div class="rv ${good?'good':'open'}"><button type="button" class="rvh" aria-expanded="${good?'false':'true'}"><span class="rvn">${good?ic('check'):i+1}</span><b>${esc(it.s)}</b><span class="ch">${ic('chev')}</span></button>
      <div class="rvb"><div><div class="rvi"><div class="rvl"><button type="button" class="lsn" data-p="${i}" aria-label="Tinglash">${ic('vol')}</button><div class="uz">${esc(it.uz)}</div></div>
        <div class="ro">${it.o.map(([L,x])=>{const right=L===it.k,mine=L===a&&!right,tr=it.traps[L];return `<div class="o ${right?'right':mine?'mine':''}"><div class="ol"><em>${L})</em><span>${esc(x)}</span>${right?'<span class="tg g">to‘g‘ri javob</span>':`<span class="tg">${esc(DOC.trap[tr[0]])}</span>`}${mine?'<span class="tg you">siz tanladingiz</span>':''}</div>${right?'':`<p>${esc(tr[1])}</p>`}</div>`}).join('')}</div>
        <div class="why"><b>Nega ${it.k}?</b> ${esc(it.why)}${a?'':' <span class="tg you">javob bermadingiz</span>'}</div></div></div></div></div>`}).join('')}</div>`,
    back?`<div class="dk-l"></div><button type="button" class="btn pri" id="nb">Hisobotga qaytish</button>`:`<div class="dk-l">Keyingi bosqich: tinglab yozish</div><button type="button" class="btn pri" id="nb">B · Eshitib yozing ${ic('arr')}</button>`);
  anim();if(fresh)FEEL.play(r.ok>=6?'success':'complete');
  const sync=()=>{const all=$$('.rv').every(x=>x.classList.contains('open'));$('#tgl').textContent=all?'Hammasini yopish':'Hammasini ochish'};
  $$('.rvh').forEach(h=>h.onclick=()=>{const v=h.parentElement,on=v.classList.toggle('open');h.setAttribute('aria-expanded',String(on));sync()});
  $('#tgl').onclick=()=>{const all=$$('.rv').every(x=>x.classList.contains('open'));$$('.rv').forEach(x=>{x.classList.toggle('open',!all);x.firstElementChild.setAttribute('aria-expanded',String(!all))});sync()};sync();
  const listen=i=>{const it=t.items[i];playAu(akey(t,it),{until:it.cut,len:it.cut})};
  $$('[data-p]').forEach(b=>b.onclick=()=>{const i=+b.dataset.p;if(AUD.has(akey(t,t.items[i])))listen(i);else ensureAudio(t).then(()=>listen(i),()=>toast('Audio yuklanmadi. Internetni tekshiring.'))});
  ensureAudio(t).catch(()=>{});
  $('#nb').onclick=()=>back?report(t,false):stageB(t)}

/* ================= B · listen and write the missing word ================= */
function stageB(t){let i=0,ok=0,listens=0;LEAVE=null;
  view(`${stepper('B')}${help('pen','<b>Gapni tinglang va tushib qolgan so‘zni yozing.</b> Kerak bo‘lsa, qayta tinglang. Imtihonda gap ikki marta o‘qiladi: har bir so‘zni ilg‘ashga o‘rganing.','Listen and type the missing word.')}<div id="pane"></div>`,
    `<div class="dk-l"><b id="dkn">0</b> to‘g‘ri</div><button type="button" class="btn pri" id="ck">Tekshirish</button>`);
  const ck=$('#ck');
  const draw=()=>{const it=t.items[i];let did=false,heard=0;
    pane(stageCard({n:i+1,of:8,it,replay:true})+`<section class="card sentc"><p class="sent">${esc(it.gs).replace('___','<input class="gap" id="g" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Tushib qolgan so‘z">')}</p><div class="fbk" id="fb"><div></div></div></section>`);
    ck.innerHTML='Tekshirish';
    const pl=()=>{heard++;listens++;playItem(t,it,{txt:heard+' marta tingladingiz'})};
    const g=$('#g');$('#rp').onclick=()=>{pl();if(!did&&matchMedia('(hover:hover) and (pointer:fine)').matches)g.focus()};
    g.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();ck.click()}};
    if(matchMedia('(hover:hover) and (pointer:fine)').matches)g.focus();
    ck.onclick=()=>{if(did){if(i<7){i++;draw()}else{const d=sget(t.id);d.b={ok,of:8,listens,at:Date.now()};sput(t.id,d);stageC(t)}return}
      if(!norm(g.value)){FEEL.play('warn');toast('Avval so‘zni yozing');g.focus();return}
      did=true;const good=it.gap.map(norm).includes(norm(g.value));if(good)ok++;stopAu();$('#stage').classList.remove('play');FEEL.play(good?'correct':'wrong');
      g.readOnly=true;g.classList.add(good?'ok':'no');g.blur();
      $('#fb').firstElementChild.innerHTML=`<div class="cfb ${good?'ok':'no'}" role="status"><div class="hd">${ic(good?'check':'x')}<span>${good?'To‘g‘ri!':'To‘g‘ri so‘z: '+esc(it.gap[0])}</span></div><span class="en">${esc(it.s)}</span><span class="uz">${esc(it.uz)}</span></div>`;
      $('#fb').classList.add('on');$('#dkn').textContent=ok;ck.innerHTML=(i<7?'Keyingi gap':'C · Gapning maqsadi')+' '+ic('arr')};
    pl()};
  ensureAudio(t).then(draw,()=>{toast('Audio yuklanmadi. Internetni tekshiring.');go('')})}

/* ================= C · what is the speaker doing? (audio only) ================= */
function stageC(t){let i=0,ok=0;LEAVE=null;
  view(`${stepper('C')}${help('target','<b>Javoblarga qaramasdan oldin o‘ylang: so‘zlovchi nima qilyapti?</b> Savol beryaptimi, taklif qilyaptimi, xabar aytyaptimi? Buni bilsangiz, qanday javob kerakligi oldindan ma’lum bo‘ladi.','Listen only. What is the speaker doing?')}<div id="pane"></div>`,
    `<div class="dk-l"><b id="dkn">0</b> to‘g‘ri</div><button type="button" class="btn pri" id="nx" disabled></button>`);
  const nx=$('#nx');
  const draw=()=>{const it=t.items[i],ops=shuf(it.fn.map((k,j)=>[k,j===0]));let did=false,heard=0;
    pane(stageCard({n:i+1,of:8,it,replay:true})+`<div class="veil" id="hs">${ic('eye')}<span>Gap matni javobdan keyin ochiladi.</span></div>`+optsHTML(ops.map(([k],j)=>[String(j),String(j+1),DOC.fn[k][0]]))+`<div class="fbk" id="fb"><div></div></div>`);
    nx.disabled=true;nx.innerHTML=(i<7?'Keyingi gap':'D · Iboralar')+' '+ic('arr');
    const pl=()=>{heard++;playItem(t,it,{txt:heard+' marta tingladingiz'})};$('#rp').onclick=pl;
    $$('.opt').forEach(b=>b.onclick=()=>{if(did)return;did=true;const good=ops[+b.dataset.v][1];if(good)ok++;stopAu();$('#stage').classList.remove('play');FEEL.play(good?'correct':'wrong');
      $$('.opt').forEach((x,j)=>{x.disabled=true;if(ops[j][1])x.classList.add('ok');else if(x===b)x.classList.add('no');else x.classList.add('dim')});
      const k=it.fn[0];
      $('#hs').outerHTML=`<section class="card shown"><p class="sent">${esc(it.s)}</p><span class="uz">${esc(it.uz)}</span></section>`;
      $('#fb').firstElementChild.innerHTML=`<div class="cfb ${good?'ok':'no'}" role="status"><div class="hd">${ic(good?'check':'x')}<span>${good?'To‘g‘ri!':esc(DOC.fn[k][0])}</span></div><span class="rl">${esc(DOC.fn[k][1])}</span><span class="rp">${ic('arr')}<span>${esc(replyOf(it))}</span></span></div>`;
      $('#fb').classList.add('on');$('#dkn').textContent=ok;nx.disabled=false});
    nx.onclick=()=>{if(i<7){i++;draw()}else{const d=sget(t.id);d.c={ok,of:8,at:Date.now()};sput(t.id,d);stageD(t)}};
    pl()};
  ensureAudio(t).then(draw,()=>{toast('Audio yuklanmadi. Internetni tekshiring.');go('')})}

/* ================= D · reply phrases: tap to match ================= */
function stageD(t){matchStage(t,{step:'D',rows:t.phrases,bank:'Ma’nolar banki',pick:'Ma’noni bosing, keyin katakni',
  help:help('msg','<b>Bu iboralar shu testdan olingan.</b> Har biriga o‘zbekcha ma’nosini bankdan tanlab qo‘ying. Bunday tayyor iboralar Part 1 javoblarida qayta-qayta uchraydi.','Match each phrase with its meaning.'),
  done:(first,of)=>{const d=sget(t.id);d.d={first,of,at:Date.now()};sput(t.id,d)},nextLabel:'E · Tezkor raund',next:()=>stageE(t)})}

/* ================= E · speed round: one listen, shuffled replies, 5 seconds ================= */
function stageE(t){const d0=sget(t.id),run=d0.run&&d0.run.s==='E'?d0.run:null;LEAVE=null;
  view(`${stepper('E')}<section class="card cover"><span class="eb">Tezkor raund · 8 ta gap</span><h2>O‘sha gaplar, lekin endi tezroq</h2>
    <ul class="rules"><li><span class="ri">${ic('head')}</span><span>Har bir gap <b>bir marta</b> o‘qiladi</span></li>
      <li><span class="ri">${ic('shuf')}</span><span>Gaplar va javoblar tartibi <b>aralashtirilgan</b></span></li>
      <li><span class="ri">${ic('clock')}</span><span>Javob uchun <b>5 soniya</b></span></li>
      <li><span class="ri">${ic('up')}</span><span>Natija A bosqichdagi testingiz bilan solishtiriladi</span></li></ul></section>`,
    `<div class="dk-l" id="ld">Audio yuklanmoqda…</div><button type="button" class="btn pri" id="go" disabled>${run?'Davom ettirish':'Boshlash'} ${ic('arr')}</button>`);
  const ready=()=>{$('#ld').innerHTML=run?`<b>${run.p+1}</b>-gapdan davom etasiz`:'<b>8</b> ta gap · audio tayyor'};
  $('#go').onclick=()=>{const b=$('#go');if(b._retry){b._retry=false;b.innerHTML=(run?'Davom ettirish':'Boshlash')+' '+ic('arr');prep(t,ready);return}runE(t,run)};
  prep(t,ready)}
function runE(t,run){const ok8=a=>Array.isArray(a)&&a.length===8;
  const order=run&&ok8(run.order)?run.order.slice():shuf([...Array(8).keys()]),ans=run&&ok8(run.ans)?run.ans.slice():Array(8).fill('');let p=run?Math.min(7,run.p|0):0;
  const keep=()=>{const d=sget(t.id);d.run={s:'E',p,order,ans};sput(t.id,d)};
  const score=()=>ans.filter((a,j)=>a===t.items[j].k).length;
  LEAVE={h:'Tezkor raund tugamagan',p:'Chiqsangiz, keyingi safar shu gapdan davom etasiz.'};
  view(`${stepper('E')}<div id="pane"></div>`,`<div class="dk-l"><b id="dkn">${score()}</b> to‘g‘ri</div>`);
  const next=()=>{p++;if(p>=8){LEAVE=null;const d=sget(t.id);delete d.run;d.e={ans,ok:score(),at:Date.now()};d.done=true;d.at=Date.now();
      d.r={ok:d.a.ok,of:8,inf:`A ${d.a.ok}/8 · B ${d.b.ok}/8 · C ${d.c.ok}/8 · D ${d.d.first}/${d.d.of} · E ${d.e.ok}/8`};sput(t.id,d);report(t,true);return}draw()};
  function draw(){keep();const i=order[p],it=t.items[i],ops=shuf(it.o);let did=false;
    pane(stageCard({n:p+1,of:8,it})+optsHTML(ops.map(([L,x],j)=>[L,String(j+1),x])));
    const pick=v=>{if(did)return;did=true;clearTimers();stopAu();const sg=$('#stage');if(sg)sg.classList.remove('play');ans[i]=v;const good=v===it.k;
      $$('.opt').forEach(x=>{x.disabled=true;if(x.dataset.v===it.k)x.classList.add('ok');else if(x.dataset.v===v)x.classList.add('no');else x.classList.add('dim')});
      $('#dkn').textContent=score();FEEL.play(good?'correct':'wrong');later(next,good?700:1500)};
    $$('.opt').forEach(b=>b.onclick=()=>pick(b.dataset.v));
    playItem(t,it,{end:()=>{if(!did)countdown(5,()=>pick(''),'Javobni tanlang')}})}
  draw()}

/* ================= the report of one test ================= */
function report(t,fresh){const d=sget(t.id),a=d.a,e=d.e,tr=trapsOf(t,a.ans),tr2=trapsOf(t,e.ans),nx=DOC.tests[DOC.tests.indexOf(t)+1];LEAVE=null;
  const names=Object.assign({},DOC.trap,{blank:'Javobsiz qoldirilgan'});
  const tl=Object.keys(names).filter(k=>tr[k]||tr2[k]).map(k=>`<tr><td><b>${esc(names[k])}</b></td><td class="c">${tr[k]||0}</td><td class="c">${tr2[k]||0}</td></tr>`).join('');
  const up=e.ok-a.ok,st=isStep(t.id);
  const sb=[['A','Test',a.ok,8],['B','Eshitib yozing',d.b.ok,8],['C','Gapning maqsadi',d.c.ok,8],['D','Iboralar',d.d.first,d.d.of],['E','Tezkor raund',e.ok,8]];
  view(`<section class="win"><span class="eb">Test ${t.n} · ${esc(t.mock)}</span><h1>${fresh?'Test yakunlandi!':'Bu test bajarilgan'}</h1>
      <div class="cmp"><div class="cb"><small>Test</small><b>${a.ok}<em>/8</em></b></div>${ic('arr')}<div class="cb"><small>Tezkor raund</small><b>${e.ok}<em>/8</em></b></div></div>
      ${up>0?`<span class="upb">${ic('up')} +${up} o‘sish</span>`:up===0&&e.ok===8?`<span class="upb">${ic('check')} barqaror a’lo</span>`:''}</section>
    <section class="card"><h3>Bosqichlar natijasi</h3><div class="sbars">${sb.map(([k,l,v,m])=>`<div class="sb"><div class="col"><i data-h="${Math.max(7,Math.round(v/m*100))}%"></i></div><b>${v}/${m}</b><small>${k} · ${l}</small></div>`).join('')}</div>
      <p class="sub" style="margin:12px 0 0">B bosqichda ${d.b.listens} marta tingladingiz. D bosqich: birinchi urinishdagi natija.</p></section>
    ${tl?`<section class="card"><h3>Men tushgan tuzoqlar</h3><div class="tw"><table><thead><tr><th>Tuzoq turi</th><th class="c">A · Test</th><th class="c">E · Tezkor raund</th></tr></thead><tbody>${tl}</tbody></table></div></section>`:''}
    <section class="card"><h3>Mening iboralar jadvalim</h3><p class="sub">Bu jadvalni lug‘at daftaringizga ko‘chiring.</p>
      <div class="tw"><table><thead><tr><th>#</th><th>Ibora</th><th>O‘zbekcha</th></tr></thead><tbody>${t.phrases.map((r,i)=>`<tr><td class="n">${i+1}</td><td><b>${esc(r[0])}</b></td><td class="u">${esc(r[1])}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="card"><h3>8 ta gap va to‘g‘ri javoblar</h3><div class="tw"><table><tbody>${t.items.map((it,i)=>`<tr><td class="n">${i+1}</td><td><b>${esc(it.s)}</b><span class="rpl">→ ${esc(replyOf(it))}</span></td></tr>`).join('')}</tbody></table></div></section>`,
    `<button type="button" class="btn" id="ra">${ic('list')}<span>Tahlil</span></button><button type="button" class="btn" id="again">${ic('redo')}<span>Qayta<span class="lg"> ishlash</span></span></button>`+
    (st?`<button type="button" class="btn pri" id="dn">Bajardim ${ic('check')}</button>`:nx?`<button type="button" class="btn pri" id="nt">Test ${nx.n} ${ic('arr')}</button>`:`<button type="button" class="btn pri" id="hm">Testlar</button>`));
  dockin.classList.add('three');anim();
  if(fresh){FEEL.play('celebrate');confetti()}
  $('#ra').onclick=()=>resA(t,false,true);
  $('#again').onclick=()=>modal('Qayta ishlaysizmi?','Bu testning natijalari shu qurilmada o‘chadi va A bosqichdan boshlanadi.',[{t:'Bekor qilish'},{t:'Qayta ishlash',cls:'pri',f:()=>{sput(t.id,{n:(d.n||1)+1});openTest(t)}}]);
  const dn=$('#dn');if(dn)dn.onclick=goDone;
  const b=$('#nt');if(b)b.onclick=()=>go(nx.id);const h=$('#hm');if(h)h.onclick=()=>go('')}

/* ================= router, keys, start ================= */
function route(){const t=DOC.tests.find(x=>x.id===(H.x||''));if(t)openTest(t);else hub()}
addEventListener('hashchange',()=>{const h=hp();if(!PREVIEW&&h.d!==DID){location.reload();return}H=h;if(DOC)route()});
document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||own(document.activeElement)||$('#mbg'))return;
  const os=$$('#opts .opt:not(:disabled)');
  if(os.length&&/^[a-c1-3]$/i.test(e.key)){const k=e.key.toLowerCase(),b=os.find(x=>x.dataset.v.toLowerCase()===k||x.firstElementChild.textContent.toLowerCase()===k);if(b){e.preventDefault();b.click()}return}
  if(e.key==='Enter'){const b=dockin.querySelector('.btn.pri:not(:disabled)');if(b){e.preventDefault();b.click()}}});
async function boot(){
  if(PREVIEW){DOC=PREVIEW.doc;Object.keys(PREVIEW.aud).forEach(k=>AUD.set(k,PREVIEW.aud[k]));$('#tag').hidden=false;route();return}
  if(!DID||!/^[a-z0-9-]+$/.test(DID)){fail('Booster topilmadi','Havola noto‘g‘ri. Xaritadan qayta oching.','./#/me');return}
  setBack(mapHref(),STEP?'Xarita':'Orqaga');
  if(!ls(ST+'k')){fail('Avval kiring','Bu booster faqat EDUNEST o‘quvchilari uchun. Platformaga kiring va xaritadan oching.');return}
  try{DOC=JSON.parse(new TextDecoder().decode(await load(DID)))}
  catch(e){e.message==='net'?fail('Yuklanmadi','Internetni tekshirib, sahifani yangilang.','./#/me'):fail('Qayta kiring','Kirish muddati tugagan. Platformaga qaytadan kiring.');return}
  if(!DOC||!ENG[DOC.kind]||!Array.isArray(DOC.tests)||!DOC.tests.length){fail('Booster topilmadi','Havola noto‘g‘ri. Xaritadan qayta oching.','./#/me');return}   /* also a doc whose engine this page does not have (yet) */
  watermark();route();
}
FEEL.init({ns:ST,quiet:()=>AUP});   /* sound, vibration and press feedback (FEEL, top of this script); the page's own sounds wait while a sentence plays */
boot();
