
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

/* =================== SETTINGS =================== */
const CLOUD_URL = "https://tuffyskazbkbezsghgtk.supabase.co/functions/v1/api";
const BOOSTER_URL = "https://toxirovteacher.github.io/edunest-multilevel/booster.html";
const G3 = /*G3*/false;
const GROUPS = G3?["DOLPHINS","PENGUINS"]:["SHARKS","FARMERS","GUEST"];
const SITE_GROUPS = ["DOLPHINS","PENGUINS"];
const mineG=g=>G3?SITE_GROUPS.includes(String(g).toUpperCase()):!SITE_GROUPS.includes(String(g).toUpperCase());
const mineA=a=>{const gs=String(a.groups||"ALL").toUpperCase().split(/[,\s]+/).filter(Boolean);return gs.includes("ALL")?!G3:gs.some(mineG)};
const BOOSTER_TESTS = 30;
/* ================================================ */
const LOGO=new URL('img/logo.png',document.baseURI).href;
const PHOTO=new URL('img/photo.jpg',document.baseURI).href;
const ST=G3?"edunest_g3:":"edunest_mlb:";
function sha256(s){s=unescape(encodeURIComponent(s));function r(v,a){return(v>>>a)|(v<<(32-a))}
var mp=Math.pow,mw=mp(2,32),res='',words=[],abl=s.length*8,hash=[],k=[],pc=0,ic={},i,j;
for(var c=2;pc<64;c++){if(!ic[c]){for(i=0;i<313;i+=c)ic[i]=c;hash[pc]=(mp(c,.5)*mw)|0;k[pc++]=(mp(c,1/3)*mw)|0}}
s+='\x80';while(s.length%64-56)s+='\x00';
for(i=0;i<s.length;i++){j=s.charCodeAt(i);words[i>>2]|=j<<((3-i)%4)*8}
words[words.length]=((abl/mw)|0);words[words.length]=abl;
for(j=0;j<words.length;){var w=words.slice(j,j+=16),oh=hash;hash=hash.slice(0,8);
for(i=0;i<64;i++){var w15=w[i-15],w2=w[i-2],a=hash[0],e=hash[4];
var t1=hash[7]+(r(e,6)^r(e,11)^r(e,25))+((e&hash[5])^((~e)&hash[6]))+k[i]+(w[i]=(i<16)?w[i]:(w[i-16]+(r(w15,7)^r(w15,18)^(w15>>>3))+w[i-7]+(r(w2,17)^r(w2,19)^(w2>>>10)))|0);
var t2=(r(a,2)^r(a,13)^r(a,22))+((a&hash[1])^(a&hash[2])^(hash[1]&hash[2]));
hash=[(t1+t2)|0].concat(hash);hash[4]=(hash[4]+t1)|0}
for(i=0;i<8;i++)hash[i]=(hash[i]+oh[i])|0}
for(i=0;i<8;i++)for(j=3;j+1;j--){var b=(hash[i]>>(j*8))&255;res+=((b<16)?0:'')+b.toString(16)}return res}


const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}
function sstore(k,v){try{if(v===undefined)return sessionStorage.getItem(k);if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,v)}catch(e){return null}}
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2600)}
const cleanName=n=>String(n||'').replace(/[ʻʼ‘’`´]/g,"'").replace(/\s+/g,' ').trim();
const title=n=>cleanName(n).toLowerCase().split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
const initials=n=>cleanName(n).split(' ').map(w=>w.replace(/[^A-Za-z]/g,'')[0]||'').join('').slice(0,2).toUpperCase();
const phone9=p=>{p=String(p||'').replace(/\D/g,'');if(p.length>9&&p.startsWith('998'))p=p.slice(3);return p.slice(-9)};
const phoneNice=p=>{p=phone9(p);return p.length===9?`+998 ${p.slice(0,2)} ${p.slice(2,5)} ${p.slice(5,7)} ${p.slice(7)}`:'—'};
const tel=p=>'tel:+998'+phone9(p);
const fmt=ms=>{const s=Math.round((ms||0)/1000),m=Math.floor(s/60);return m+':'+String(s%60).padStart(2,'0')};
const fmtLong=ms=>{const m=Math.round((ms||0)/60000);return m<60?m+' min':Math.floor(m/60)+' h '+(m%60)+' min'};
const ago=t=>{if(!t)return '—';const d=(Date.now()-t)/60000;if(d<2)return 'just now';if(d<60)return Math.round(d)+' min ago';if(d<1440)return Math.round(d/60)+' h ago';const n=Math.round(d/1440);return n===1?'yesterday':n+' days ago'};
let U=null, P=null, TD=null, ui={};

/* ---------- cloud ---------- */
async function cget(params,ms){const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),ms||15000);
  try{const r=await fetch(CLOUD_URL+'?'+new URLSearchParams(params),{signal:ctl.signal});return await r.json()}finally{clearTimeout(t)}}
async function cpost(body){const r=await fetch(CLOUD_URL,{method:'POST',body:JSON.stringify(body)});return await r.json()}

/* ---------- theme ---------- */
function setTheme(d){document.body.classList.toggle('dark',d);document.querySelectorAll('#themeToggle,#themeToggle2,#themeToggle3').forEach(b=>b.textContent=d?'☀️':'🌙');store(ST+'dark',d?'1':'0')}
setTheme(store(ST+'dark')==='1'||(store(ST+'dark')==null&&matchMedia('(prefers-color-scheme: dark)').matches));
document.querySelectorAll('#themeToggle,#themeToggle2,#themeToggle3').forEach(b=>b.onclick=()=>setTheme(!document.body.classList.contains('dark')));
document.querySelectorAll('img.lg').forEach(i=>i.src=LOGO);document.querySelectorAll('img.tph').forEach(i=>{i.addEventListener('error',()=>{if(i.src!==PHOTO)i.src=PHOTO});i.src='teacher.jpg'});
/* hero uses the full-resolution teacher.jpg; if that file is missing, fall back to the small built-in copy */
{const t=document.getElementById('tPhoto');if(t){const fb=()=>{if(t.src!==PHOTO)t.src=PHOTO};t.addEventListener('error',fb);if(t.complete&&!t.naturalWidth)fb()}}
$('#c1share').onclick=async()=>{const url=location.href.split('#')[0]+'#/c1';const d={title:'Listening 5.0 dan 7.5–8.0 ga: A\'zamjon Toxirovning usuli',text:'1.5 oyda Listening’ni 7.5–8.0 ga chiqargan 10 qadam',url};try{if(navigator.share){await navigator.share(d);return}await navigator.clipboard.writeText(url);toast('Havola nusxalandi')}catch(e){}};
document.querySelectorAll('[data-scroll]').forEach(a=>a.onclick=e=>{e.preventDefault();document.getElementById(a.dataset.scroll).scrollIntoView({behavior:'smooth'})});
/* landing menu on phones and tablets (27.11.2026): the same links as the desktop bar; closes on a link, outside tap, Esc or page change */
{const bar=document.querySelector('#landing .lp-bar'),b=$('#lpMenu'),nav=$('#lpNav');if(bar&&b&&nav){
  const set=o=>{bar.classList.toggle('open',o);b.setAttribute('aria-expanded',String(o))},isOpen=()=>bar.classList.contains('open');
  b.onclick=e=>{e.stopPropagation();set(!isOpen())};
  nav.addEventListener('click',e=>{if(e.target.closest('a'))set(false)});
  document.addEventListener('click',e=>{if(isOpen()&&!bar.contains(e.target))set(false)});
  addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen()){set(false);b.focus()}});
  addEventListener('hashchange',()=>set(false));
  addEventListener('resize',()=>{if(isOpen()&&innerWidth>980)set(false)},{passive:true})}}
/* results wall: Multi-Level / IELTS tabs (click, or left/right arrow keys) */
{const T=[...document.querySelectorAll('.nt-tab')];const sel=t=>T.forEach(x=>{const on=x===t;x.setAttribute('aria-selected',on);x.tabIndex=on?0:-1;document.getElementById(x.getAttribute('aria-controls')).hidden=!on});
  T.forEach((t,i)=>{t.onclick=()=>sel(t);t.onkeydown=e=>{const d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!d)return;e.preventDefault();const n=T[(i+d+T.length)%T.length];sel(n);n.focus()}})}
/* teacher certificates (Multi-Level page): papers on a desk, a magnifier on hover, and a full-quality viewer */
{const S=document.getElementById('cfStage'),P=S?[...S.querySelectorAll('.cf-paper')]:[];
if(P.length){const T=[...document.querySelectorAll('.cf-tile')];
  const front=i=>{S.dataset.front=i;T.forEach(t=>t.classList.toggle('on',+t.dataset.doc===i))};
  [...P,...T].forEach(b=>{const i=+b.dataset.doc;b.addEventListener('pointerenter',()=>front(i));b.addEventListener('focus',()=>front(i))});
  if(matchMedia('(hover:hover) and (pointer:fine)').matches)P.forEach(p=>{const L=p.querySelector('.cf-lens'),Z=2.5;let bg=0;
    p.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;
      if(!bg){bg=1;const s=p.querySelector('img');L.style.backgroundImage=`url("${p.dataset.full}"),url("${s.currentSrc||s.src}")`}
      const x=e.offsetX,y=e.offsetY;L.style.backgroundSize=`${p.offsetWidth*Z}px ${p.offsetHeight*Z}px`;
      L.style.backgroundPosition=`${75-x*Z}px ${75-y*Z}px`;L.style.translate=`${x}px ${y}px`;p.classList.add('lz')});
    p.addEventListener('pointerleave',()=>p.classList.remove('lz'))});
  const ic=d=>`<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const lb=document.createElement('div');lb.className='cf-lb';lb.hidden=true;lb.setAttribute('role','dialog');lb.setAttribute('aria-modal','true');lb.setAttribute('aria-labelledby','cfLbT');
  lb.innerHTML=`<div class="cf-lb-bar"><div class="cf-lb-ttl"><b id="cfLbT"></b><small></small></div><span class="cf-lb-hd" title="To‘liq sifatdagi nusxa">HD</span>`+
    `<button type="button" data-a="z" aria-label="Kattalashtirish" aria-pressed="false">${ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/><path class="cf-zv" d="M11 8v6"/>')}</button>`+
    `<button type="button" data-a="x" aria-label="Yopish">${ic('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>`+
    `<div class="cf-lb-view"><img class="cf-lb-img" width="960" height="1358" alt="" draggable="false"></div>`+
    `<div class="cf-lb-foot"><button type="button" data-a="p" aria-label="Oldingi hujjat">${ic('<path d="m15 6-6 6 6 6"/>')}</button>`+
    `<p><b class="cf-lb-n"></b><span class="cf-lb-cap"></span></p>`+
    `<button type="button" data-a="n" aria-label="Keyingi hujjat">${ic('<path d="m9 6 6 6-6 6"/>')}</button></div>`;
  document.body.appendChild(lb);
  const q=s=>lb.querySelector(s),img=q('.cf-lb-img'),view=q('.cf-lb-view'),hd=q('.cf-lb-hd'),zb=q('[data-a="z"]');let cur=0,back=null,tok=0,off=[],drag=null,moved=0,sx=null;
  const zoom=(z,fx,fy)=>{lb.classList.toggle('zoom',z);zb.setAttribute('aria-pressed',z);zb.setAttribute('aria-label',z?'Kichraytirish':'Kattalashtirish');
    if(z){view.scrollLeft=fx*img.offsetWidth-view.clientWidth/2;view.scrollTop=fy*img.offsetHeight-view.clientHeight/2}else view.scrollTop=view.scrollLeft=0};
  const show=i=>{cur=(i+P.length)%P.length;const p=P[cur],s=p.querySelector('img'),t=++tok;zoom(false);
    img.src=s.currentSrc||s.src;img.alt=p.dataset.alt;q('#cfLbT').textContent=p.dataset.title;q('.cf-lb-ttl small').textContent=p.dataset.sub;
    q('.cf-lb-n').textContent=(cur+1)+' / '+P.length;hd.classList.remove('on');
    const cap=q('.cf-lb-cap');cap.textContent='';if(p.dataset.no){const a=document.createElement('a');a.href=p.dataset.verify;a.target='_blank';a.rel='noopener';a.dataset.copy=p.dataset.no;
      a.textContent='sertifikat.uzbmb.uz saytida tekshirish ↗';cap.append('Raqam '+p.dataset.no+' · ',a)}else cap.textContent='Shaxsiy raqamlar yashirilgan · rasmni bosib kattalashtiring';
    const f=new Image();f.src=p.dataset.full;f.decode().then(()=>{if(t===tok){img.src=f.src;hd.classList.add('on')}}).catch(()=>{});front(cur)};
  const open=i=>{back=document.activeElement;show(i);lb.hidden=false;off=[...document.body.children].filter(c=>c!==lb&&!c.inert);off.forEach(c=>c.inert=true);
    document.documentElement.classList.add('cf-lock');requestAnimationFrame(()=>lb.classList.add('in'));q('[data-a="x"]').focus()};
  const close=()=>{lb.classList.remove('in');lb.hidden=true;off.forEach(c=>c.inert=false);off=[];document.documentElement.classList.remove('cf-lock');if(back&&back.focus)back.focus()};
  document.querySelectorAll('[data-doc]').forEach(b=>b.addEventListener('click',()=>open(+b.dataset.doc)));
  /* certificate number: the copy button copies it, and the verify link copies it too, ready to paste on the official site */
  document.addEventListener('click',e=>{const c=e.target.closest('[data-copy]');if(!c)return;const n=c.dataset.copy,b=c.classList.contains('cf-copy')?c:null;
    const ok=()=>{if(b){b.textContent='Nusxalandi ✓';clearTimeout(b._t);b._t=setTimeout(()=>b.textContent='Nusxa olish',2000)}},
      no=()=>{const k=b&&b.parentNode.querySelector('.cf-no');if(k){const r=document.createRange();r.selectNodeContents(k);const s=getSelection();s.removeAllRanges();s.addRange(r)}};
    try{navigator.clipboard.writeText(n).then(ok,no)}catch(_){no()}});
  lb.addEventListener('click',e=>{const a=e.target.closest('[data-a]');if(a){const k=a.dataset.a;if(k==='x')close();else if(k==='z')zoom(!lb.classList.contains('zoom'),.5,0);else show(cur+(k==='n'?1:-1))}
    else if(e.target===view)close()});
  img.addEventListener('click',e=>{if(moved){moved=0;return}const r=img.getBoundingClientRect();zoom(!lb.classList.contains('zoom'),(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height)});
  view.addEventListener('pointerdown',e=>{moved=0;if(e.pointerType==='mouse'&&lb.classList.contains('zoom'))drag={x:e.clientX,y:e.clientY,l:view.scrollLeft,t:view.scrollTop}});
  addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)moved=1;view.scrollLeft=drag.l-dx;view.scrollTop=drag.t-dy});
  addEventListener('pointerup',()=>{drag=null});
  view.addEventListener('touchstart',e=>{sx=lb.classList.contains('zoom')||e.touches.length>1?null:[e.touches[0].clientX,e.touches[0].clientY]},{passive:true});
  view.addEventListener('touchend',e=>{if(!sx)return;const t=e.changedTouches[0],dx=t.clientX-sx[0],dy=t.clientY-sx[1];sx=null;if(Math.abs(dx)>50&&Math.abs(dx)>1.5*Math.abs(dy))show(cur+(dx<0?1:-1))},{passive:true});
  document.addEventListener('keydown',e=>{if(lb.hidden)return;
    if(e.key==='Escape'){e.preventDefault();close()}else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();show(cur+(e.key==='ArrowRight'?1:-1))}
    else if(e.key==='Tab'){const f=[...lb.querySelectorAll('button')],a=f[0],z=f[f.length-1],o=document.activeElement;
      if(!lb.contains(o)){e.preventDefault();a.focus()}else if(e.shiftKey&&o===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&o===z){e.preventDefault();a.focus()}}})}}

/* ---------- modal ---------- */
function modal(html,btns){closeModals();const bg=document.createElement('div');bg.className='modal-bg';
  bg.innerHTML=`<div class="card modal" role="dialog">${html}<div class="mbtns">${(btns||[]).map((b,i)=>`<button class="btn ${b.cls||'ghost'} big" data-i="${i}">${b.t}</button>`).join('')}</div></div>`;
  document.body.appendChild(bg);bg.onclick=e=>{if(e.target===bg)closeModals()};
  bg.querySelectorAll('[data-i]').forEach(x=>x.onclick=async()=>{const b=btns[+x.dataset.i];if(b.keep){x.disabled=true;let r;try{r=await b.f()}finally{x.disabled=false}if(r!==false)closeModals();return}closeModals();if(b.f)b.f()});}
function closeModals(){document.querySelectorAll('.modal-bg').forEach(m=>m.remove())}

/* ================= LOGIN ================= */
function showLogin(role){
  document.body.classList.remove('st-mode');
  $('#app').classList.add('hide');$('#landing').classList.add('hide');$('#c1page').classList.add('hide');$('#login').classList.remove('hide');$('#themeFloat').classList.remove('hide');
  role=role||ui.role||'student';ui.role=role;ui.lstep=null;
  const last=store(ST+'lastId');
  if(G3&&role==='guest')role=ui.role='student';
  $('#loginForm').innerHTML=`
    <a class="lback" href="#/">← Bosh sahifa</a>
    ${role==='teacher'?`<h2 class="lx-h">Ustoz paneli</h2><p class="lx-sub">Faqat ustoz uchun. Parolni hech kimga bermang.</p>`:`
    <h2 class="lx-h">${role==='guest'?'Mehmon sifatida kirish':'Hisobingizga kiring'}</h2>
    <p class="lx-sub">${role==='guest'?'Darsga endi kelgan bo‘lsangiz, ustoz aytgan kod bilan 3 kun foydalanasiz.':'Telegram orqali yoki ID raqamingiz va parolingiz bilan.'}</p>
    ${G3?'':`<div class="lx-seg" role="tablist"><button role="tab" aria-selected="${role==='student'}" class="${role==='student'?'on':''}" data-r="student">O‘quvchi</button><button role="tab" aria-selected="${role==='guest'}" class="${role==='guest'?'on':''}" data-r="guest">Mehmon</button></div>`}`}
    ${role==='student'?`
      <div id="tgBox"></div>
      <div class="field"><label for="inId">ID raqamingiz</label><input id="inId" class="bigin" inputmode="numeric" autocomplete="username" placeholder="63001" value="${esc(last||'')}" enterkeyhint="next"></div>
      <div id="pinBox"></div>
      <button class="btn red big block" style="margin-top:18px" id="btnGo">Davom etish</button>
      <p class="lx-hint">ID raqamingizni EDUNEST o‘quv markazidan bilib olasiz. Birinchi kirishda o‘zingizga 4–8 xonali parol o‘ylab topasiz.</p>`
    :role==='guest'?`
      <div class="field"><label for="inName">Ism va familiya</label><input id="inName" autocomplete="name" placeholder="Qo'zivoy Qo'chqorov" enterkeyhint="next"></div>
      <div class="field"><label for="inPhone">Telefon raqam</label>
        <div class="phonebox"><span>+998</span><input id="inPhone" inputmode="numeric" autocomplete="tel-national" placeholder="90 123 45 67" maxlength="14" enterkeyhint="next"></div></div>
      <div class="field"><label for="inCode">Mehmon kodi</label><input id="inCode" class="bigin" inputmode="numeric" autocomplete="off" placeholder="Ustozdan so‘rang" enterkeyhint="go"></div>
      <button class="btn red big block" style="margin-top:18px" id="btnGo">Kirish</button>
      <p class="lx-hint">Mehmon kodini ustoz darsda aytadi. +998 ni yozmang, faqat 9 ta raqam.</p>`
    :`
      <div class="field"><label for="inPass">Ustoz paroli</label><input id="inPass" type="password" autocomplete="current-password" enterkeyhint="go"></div>
      <button class="btn navy big block" style="margin-top:18px" id="btnGo">Ustoz paneliga kirish</button>`}
    <div id="loginMsg"></div>
    <div class="lx-alt">${role==='teacher'?'<button type="button" data-r="student">← O‘quvchi sifatida kirish</button>':'<a href="https://t.me/teachertx" target="_blank" rel="noopener">Kira olmayapsizmi? Ustozga yozing</a><button type="button" data-r="teacher">Ustoz kirishi</button>'}</div>`;
  document.querySelectorAll('#loginForm [data-r]').forEach(b=>b.onclick=()=>showLogin(b.dataset.r));
  const go_=role==='student'?studentLogin:role==='guest'?guestLogin:teacherLogin;
  $('#btnGo').onclick=go_;
  bindEnter(go_);
  if(role==='guest')$('#inPhone').oninput=e=>{let p=e.target.value.replace(/\D/g,'');if(p.startsWith('998')&&p.length>9)p=p.slice(3);p=p.slice(0,9);
    e.target.value=[p.slice(0,2),p.slice(2,5),p.slice(5,7),p.slice(7)].filter(Boolean).join(' ')};
  if(role==='student')tgOffer();
  if(role==='student')$('#inId').oninput=()=>{if(ui.lstep){ui.lstep=null;$('#pinBox').innerHTML='';$('#btnGo').textContent='Davom etish'}};
}
function bindEnter(go_){document.querySelectorAll('#loginForm input').forEach((i,k,all)=>i.onkeydown=e=>{if(e.key==='Enter'){if(all[k+1])all[k+1].focus();else go_()}})}
function busy(on,msg){const b=$('#btnGo');if(b)b.disabled=on;$('#loginMsg').innerHTML=on?`<div class="loading"><div class="spin"></div>${msg||'Yuklanmoqda…'}</div>`:''}
const pinIn=(id,label)=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" class="bigin pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="${id==='inPin'?'current-password':'new-password'}" placeholder="••••"></div>`;
async function studentLogin(){
  const q=$('#inId').value.trim();if(!q){$('#inId').focus();return}
  const body={action:'login',q,v:'ml'};   /* v=ml: the server counts today as a day on the platform (General English 3 too, since 26.11.2026) */
  if(ui.lstep==='pin'){const p=$('#inPin').value.trim();if(!/^\d{4,8}$/.test(p)){toast('Parol 4–8 ta raqam');$('#inPin').focus();return}body.pin=p}
  if(ui.lstep==='setup'){const a=$('#inPin1').value.trim(),b=$('#inPin2').value.trim();
    if(!/^\d{4,8}$/.test(a)){toast('Parol 4–8 ta raqamdan iborat bo‘lsin');$('#inPin1').focus();return}
    if(a!==b){toast('Parollar bir xil emas');$('#inPin2').select();return}
    if(/^(\d)\1+$/.test(a)||'0123456789'.includes(a)||'9876543210'.includes(a)){toast('Bu parol juda oson. Boshqasini tanlang.');$('#inPin1').select();return}
    body.pin=a}
  busy(true);let j=null;try{j=await cpost(body)}catch(e){}
  busy(false);
  if(!j){toast('Internet yo‘q. Qayta urining.');return}
  if(j.ok){store(ST+'lastId',q);enter(j);return}
  if(j.error==='not found'){toast('Bu ID topilmadi. Ustozga murojaat qiling.');$('#inId').select();return}
  if(j.error==='locked'){$('#loginMsg').innerHTML='<p class="lerr">Ko‘p marta noto‘g‘ri parol kiritildi. 15 daqiqadan keyin urinib ko‘ring yoki ustozdan parolni yangilashni so‘rang.</p>';return}
  if(j.error==='setup'){ui.lstep='setup';$('#pinBox').innerHTML=`<div class="pinnote">Birinchi kirish. O‘zingizga 4–8 xonali raqamli parol o‘ylab toping va uni hech kimga aytmang.</div>${pinIn('inPin1','Yangi parol (4–8 raqam)')}${pinIn('inPin2','Parolni takrorlang')}`;$('#btnGo').textContent='Parolni saqlash va kirish';bindEnter(studentLogin);$('#inPin1').focus();return}
  if(j.error==='pin'){ui.lstep='pin';$('#pinBox').innerHTML=pinIn('inPin','Parol');$('#btnGo').textContent='Kirish';bindEnter(studentLogin);$('#inPin').focus();return}
  if(j.error==='badpin'){$('#inPin').value='';$('#inPin').focus();toast(`Parol noto‘g‘ri. Yana ${j.left} ta urinish qoldi.`);return}
  toast('Xatolik. Qayta urining.');
}
async function guestLogin(){
  const name=title($('#inName').value);const phone=phone9($('#inPhone').value);const code=$('#inCode').value.trim();
  if(name.split(' ').filter(w=>w.replace(/[^A-Za-z]/g,'').length>=2).length<2){toast('Ism va familiyani yozing');$('#inName').focus();return}
  if(phone.length!==9){toast('9 ta raqam yozing');$('#inPhone').focus();return}
  if(!code){toast('Mehmon kodini yozing');$('#inCode').focus();return}
  busy(true);let j=null;try{j=await cpost({action:'guest',name,phone,code})}catch(e){}
  busy(false);
  if(!j){toast('Internet yo‘q. Qayta urining.');return}
  if(!j.ok){toast(j.error==='code'?'Mehmon kodi noto‘g‘ri':'Ma’lumotlarni tekshiring');(j.error==='code'?$('#inCode'):$('#inName')).select();return}
  enter(j,true);
}
/* ---------- Telegram login ---------- */
const TGI='<svg class="tgi" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.4 13.2l-4.7-1.5c-1-.3-1-1 .2-1.5L20.5 3c.9-.3 1.6.2 1.4 1.3z"/></svg>';
async function tgBot(){let b=sstore(ST+'tgbot');if(b!==null)return b;try{const j=await cget({action:'cfg'},8000);b=(j&&j.tgBot)||'';sstore(ST+'tgbot',b)}catch(e){b=''}return b}
async function tgOffer(){const bot=await tgBot();const box=$('#tgBox');if(!bot||!box)return;
  box.innerHTML=`<button class="btn tg big block" id="tgGo">${TGI}Telegram orqali kirish</button><div class="ordiv"><span>yoki ID va parol bilan</span></div>`;
  $('#tgGo').onclick=()=>tgFlow('login',box)}
const TGST={wait:'Telegram’da botni oching va <b>START</b> tugmasini bosing.',contact:'Botda <b>«📱 Raqamni yuborish»</b> tugmasini bosing.',
  nomatch:'Bu raqam ro‘yxatda topilmadi. ID va parolingiz bilan kiring, keyin profilingizda <b>«Telegram’ni ulash»</b> ni bosing.',
  taken:'Bu ID yoki Telegram boshqa akkauntga ulangan. Ustozga murojaat qiling.',askid:'Botga <b>EDUNEST ID raqamingizni</b> yozib yuboring.',haspin:'Bu ID uchun parol bor. Pastda ID va parol bilan kiring, keyin profilda <b>«Telegram’ni ulash»</b> ni bosing.',expired:'Vaqt tugadi. Tugmani qayta bosing.'};
async function tgFlow(mode,box){
  (ui.tgStop=true);box.innerHTML=`<div class="tgcard"><div class="loading"><div class="spin"></div>Tayyorlanmoqda…</div></div>`;
  let j=null;try{j=await cpost(mode==='link'?{action:'tgStart',mode,id:U.id,t:U.t,site:G3?'g3':''}:{action:'tgStart',mode,site:G3?'g3':''})}catch(e){}
  if(!j||!j.ok){box.innerHTML=`<p class="lerr">Telegram orqali ulanib bo‘lmadi. Keyinroq urinib ko‘ring.</p>`;return}
  const url=`https://t.me/${j.bot}?start=${j.nonce}`;
  box.innerHTML=`<div class="tgcard"><ol class="tgsteps"><li>Pastdagi tugma bilan botni oching</li><li><b>START</b> ni bosing</li><li>«Raqamni yuborish» ni bosing va shu sahifaga qayting</li></ol>
    <a class="btn tg big block" href="${url}" target="_blank" rel="noopener" id="tgOpen">${TGI}Botni ochish</a>
    <p class="tgstat" id="tgStat" aria-live="polite"><span class="dot"></span><span>${TGST.wait}</span></p></div>`;
  let n=0,busyP=false;const end=Date.now()+14*60e3;
  const poll=async()=>{if(busyP||!document.body.contains(box))return;if(Date.now()>end){(ui.tgStop=true);$('#tgStat').innerHTML=TGST.expired;return}
    busyP=true;let r=null;try{r=await cpost({action:'tgPoll',nonce:j.nonce})}catch(e){}busyP=false;if(!r||!document.body.contains(box))return;
    if(!r.ok){(ui.tgStop=true);$('#tgStat').innerHTML=TGST.expired;return}
    if(r.st==='done'||r.student){(ui.tgStop=true);sfx('done');
      if(mode==='link'){closeModals();toast('Telegram ulandi'+(r.tgu?': '+r.tgu:''));lastFetch=0;P=null;route();return}
      store(ST+'lastId',r.uid);enter(r);return}
    const st=$('#tgStat');if(st)st.innerHTML=(['nomatch','taken','haspin'].includes(r.st)?'':'<span class="dot"></span>')+'<span>'+(TGST[r.st]||TGST.wait)+'</span>';
    if(['nomatch','taken','haspin'].includes(r.st))(ui.tgStop=true)};
  const fid=ui.tgId=(ui.tgId||0)+1;const loop=async()=>{while(document.body.contains(box)&&!ui.tgStop&&ui.tgId===fid&&Date.now()<end){await poll();if(ui.tgStop)break;await new Promise(r=>setTimeout(r,400))}};
  ui.tgStop=false;ui.tgT=0;loop();
}
function tgLinkModal(){modal(`<h3>Telegram’ni ulang</h3><p class="muted" style="margin:6px 0 12px">Shunda saytga parolsiz, Telegram orqali bir bosishda kirasiz.</p><div id="tgLinkBox"></div>`,[{t:'Yopish',f:()=>(ui.tgStop=true)}]);tgFlow('link',$('#tgLinkBox'))}
function keepKey(k){if(!k)return;store(ST+'k',k);store('edunest_booster_p1:code',String(k).toUpperCase())}
function dropKey(){store(ST+'k',null);store('edunest_booster_p1:code',null);store('edunest_booster_p1:session',null);store('edunest_booster_p1:back',null)}
function enter(j,isGuest){
  P=j;U={role:'student',id:j.uid,t:j.t,guest:j.student.type==='guest'};keepKey(j.k);
  store(ST+'session',JSON.stringify(U));store(ST+'p:'+j.uid,JSON.stringify(j));lastFetch=0;   /* load again at once, so today counts (Telegram login) */
  enterApp();go('#/me',true);
  if(isGuest){const days=Math.max(1,Math.round((+String(j.t).split('.')[0]-Date.now())/864e5));
    modal(`<div style="text-align:center"><div style="font-size:48px">👋</div><h3>Xush kelibsiz, ${esc(j.student.name.split(' ')[0])}!</h3>
    <p class="muted" style="margin-top:6px">Siz mehmon sifatida ${days} kun davomida materiallardan foydalana olasiz. Keyin yana ism, telefon va mehmon kodi bilan kirasiz.</p></div>`,[{t:'Tushunarli',cls:'red'}])}
}
async function teacherLogin(){
  const typed=$('#inPass').value.trim();if(!typed){$('#inPass').focus();return}
  busy(true);let j=null,pass=typed;
  try{j=await cpost({action:'tauth',key:typed});if(j&&!j.ok&&typed!==typed.toUpperCase()){pass=typed.toUpperCase();j=await cpost({action:'tauth',key:pass})}}catch(e){}
  busy(false);
  if(!j){toast('Internet yo‘q. Qayta urining.');return}
  if(!j.ok){toast('Parol noto‘g‘ri');$('#inPass').select();return}
  keepKey(j.k);U={role:'teacher',pass};sstore(ST+'t',pass);TD=null;enterApp();go('#/teacher',true);
}
function enterApp(){$('#login').classList.add('hide');$('#landing').classList.add('hide');$('#c1page').classList.add('hide');$('#themeFloat').classList.add('hide');$('#app').classList.remove('hide');
  $('#brandSub').textContent=U.role==='teacher'?'Ustoz paneli':(G3?'General English · Level 3':'Multi-Level');$('#homeBtn').classList.toggle('hide',U.role!=='teacher')}
function logout(silent){if(U&&U.role==='teacher')sstore(ST+'t',null);else{store(ST+'session',null);if(U)store(ST+'p:'+U.id,null)}dropKey();U=null;P=null;TD=null;
  history.replaceState(null,'','#/');if(silent)showLogin('student');else showLanding()}
$('#logoutBtn').onclick=()=>modal(`<h3>Hisobdan chiqasizmi?</h3>`,[{t:'Yo‘q'},{t:'Ha, chiqish',cls:'red',f:()=>logout()}]);
$('#homeBtn').onclick=()=>go(U&&U.role==='teacher'?'#/teacher/students':'#/me');
$('#brandHome').onclick=()=>$('#homeBtn').click();
$('#backBtn').onclick=()=>go(ui.parent||'#/');

addEventListener('scroll',()=>{const x=document.querySelector('.lp-bar');if(x)x.classList.toggle('stuck',scrollY>8)},{passive:true});
document.body.classList.toggle('g3',G3);
/* ---------- landing: 1-minute level check (own questions, nothing is sent) ---------- */
const QZ=[['My sister ___ in a bank since 2019.',['works','has worked','is working','worked'],1],
  ['If I ___ more free time, I would learn Japanese.',['have','will have','had','am having'],2],
  ['The report must ___ by Friday.',['finish','be finished','finished','be finishing'],1],
  ['She is used to ___ up early for work.',['get','got','getting','be getting'],2],
  ['The new rule had a strong ___ on prices.',['impact','affect','effort','reason'],0],
  ['I wish I ___ that to her. It really hurt her feelings.',['didn’t say','hadn’t said','wouldn’t say','don’t say'],1],
  ['Hardly ___ the station when the train left.',['we had reached','had we reached','we reached','did we reached'],1],
  ['The decision was made ___ the fact that costs were rising.',['despite of','in spite','in light of','because'],2]];
function renderQuiz(){const box=$('#lpQuiz');if(!box||G3||box.dataset.on)return;box.dataset.on=1;let i=0,ok=0,miss=[];
  const blank=s=>esc(s).replace('___','<u>&nbsp;&nbsp;&nbsp;&nbsp;</u>');
  const draw=()=>{if(i>=QZ.length){const lv=ok>=7?'C1':ok>=5?'B2':ok>=3?'B1':'A2';
      /* 27.11.2026: each wrong question with its right answer, and a way to sign up for lessons */
      box.innerHTML=`<div class="qz-res"><small>Taxminiy darajangiz</small><b>${lv}</b><p>${ok}/${QZ.length} to‘g‘ri. Bu faqat grammatika va so‘z bo‘yicha qisqa taxmin. To‘liq natija uchun Writing va Speaking’ni AI bilan tekshiring.</p>
        ${miss.length?`<ol class="qz-miss">${miss.map(k=>`<li><span>${blank(QZ[k][0])}</span><em>To‘g‘ri javob: <b>${esc(QZ[k][1][QZ[k][2]])}</b></em></li>`).join('')}</ol>`:''}
        <div class="lp-actions"><a class="lp-btn" href="#/login">Platformaga kirish</a><a class="lp-btn lp-btn-line" href="#lp-enroll" id="qzEnroll">Darsga yozilish</a><button class="qz-again" id="qzAgain" type="button">Qayta</button></div></div>`;
      $('#qzAgain').onclick=()=>{i=0;ok=0;miss=[];draw()};
      $('#qzEnroll').onclick=e=>{e.preventDefault();$('#lp-enroll').scrollIntoView({behavior:'smooth'})};return}
    const q=QZ[i];box.innerHTML=`<div class="qz-top"><span>${i+1} / ${QZ.length}</span><span class="qz-dots">${QZ.map((_,k)=>`<i class="${k<i?'on':k===i?'cur':''}"></i>`).join('')}</span></div>
      <p class="qz-q">${esc(q[0]).replace('___','<u>&nbsp;&nbsp;&nbsp;&nbsp;</u>')}</p><div class="qz-opts">${q[1].map((o,k)=>`<button type="button" data-k="${k}">${esc(o)}</button>`).join('')}</div>`;
    box.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{const k=+b.dataset.k;if(k===q[2])ok++;else miss.push(i);
      box.querySelectorAll('[data-k]').forEach(x=>{x.disabled=true;if(+x.dataset.k===q[2])x.classList.add('ok');else if(x===b)x.classList.add('no')});
      setTimeout(()=>{i++;draw()},650)})};draw()}
function showLanding(){document.title=G3?'EDUNEST · General English 3':'EDUNEST · Multi-Level';renderShow();renderQuiz();shotZoom();document.body.classList.remove('st-mode');$('#app').classList.add('hide');$('#login').classList.add('hide');$('#themeFloat').classList.add('hide');$('#landing').classList.remove('hide')}
function showC1(){document.body.classList.remove('st-mode');['#app','#login','#landing'].forEach(x=>$(x).classList.add('hide'));$('#themeFloat').classList.add('hide');$('#c1page').classList.remove('hide');scrollTo(0,0);
  document.title='C1 Listening yo‘li · A\'zamjon Toxirov · EDUNEST'}
function renderShow(){const box=$('#lpShow');if(!box||box.dataset.done)return;box.dataset.done=1;
  /* 27.11.2026: 8 Multi-Level cards (+ Listening Part 2/4/5/6 packs and the grammar topic, all live for ALL); the
     Listening-packs cover is given here, not in COVERS, so the teacher's banner chips stay as they are */
  const LPX={k:'Listening · Part 2, 4, 5, 6',w:'MASHQLAR',c1:'#221640',c2:'#7B3FE4',art:'wave'};
  const items=G3?[['u5a','5A · Fast forward','Comparatives, as … as va sonlar: dars va mashqlar'],['u5b','5B · Superlative cities?','Superlatives va shahar so‘zlari: dars va mashqlar'],['grammar','Past Simple, Would - Used to','Grammatika: dars, formula va mashqlar']]:[['lmock','Listening Mock Tests','21 ta to‘liq test: audio, natija va sertifikat'],['reading','Reading Mock Tests','11 ta to‘liq test: natija va sertifikat'],
    ['lpx','Listening mashqlari','Part 2, 4, 5 va 6 bo‘yicha alohida mashqlar',LPX],['booster','Reading Part 1 Booster','30 ta matn, har birida 5 xil mashq'],
    ['rp3','Reading Part 3 · Sarlavhalar','12 ta matn, tahlil va tarjima bilan'],['wr2','Writing namunalari','30 ta Part 1 savol va 60 ta Part 2 mavzu, C1 javoblar'],['vocab','Speaking iboralari','60 ta ibora: tarjima, misol va mashqlar'],
    ['grammar','Grammatika','Past Simple, Would - Used to: dars, formula va mashqlar']];
  box.classList.toggle('n8',items.length===8);
  box.innerHTML=items.map(([k,t,d,cv],i)=>`<div class="lp-sc">${coverHTML(k,i,'<span class="tbadge">🔒<span> O‘quvchilar uchun</span></span>',cv)}<div class="lp-scb"><b>${t}</b><small>${d}</small></div></div>`).join('');lpFx()}
/* landing (27.11.2026): the skill-card screenshots open whole and large; the card itself shows a 16:10 crop */
function shotZoom(){const S=$('#lpStack');if(!S||G3||S.dataset.zm)return;S.dataset.zm=1;
  S.querySelectorAll('.stk-win').forEach(w=>{const im=w.querySelector('.stk-img');if(!im)return;
    const b=document.createElement('button');b.type='button';b.className='stk-zoom';b.setAttribute('aria-label','Rasmni kattalashtirish: '+im.alt);
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6"/></svg>';
    w.appendChild(b);const open=()=>{if(!w.classList.contains('nf'))shotOpen(im,b)};b.onclick=open;im.addEventListener('click',open)})}
function shotOpen(im,back){let lb=$('#shotLb');
  if(!lb){lb=document.createElement('div');lb.id='shotLb';lb.className='shot-lb';lb.hidden=true;lb.setAttribute('role','dialog');lb.setAttribute('aria-modal','true');
    lb.innerHTML='<button type="button" class="shot-x" aria-label="Yopish"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><figure><img alt=""><figcaption></figcaption></figure>';
    document.body.appendChild(lb);
    lb.addEventListener('click',e=>{if(!e.target.closest('img'))shotClose()});
    lb.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();shotClose()}else if(e.key==='Tab'){e.preventDefault();lb.querySelector('.shot-x').focus()}});
    addEventListener('hashchange',shotClose)}
  const pic=lb.querySelector('img');pic.src=im.currentSrc||im.src;pic.alt=im.alt;pic.width=+im.getAttribute('width');pic.height=+im.getAttribute('height');
  lb.querySelector('figcaption').textContent=(im.closest('.stk-win').querySelector('.stk-bar span')||{}).textContent||'';
  lb._back=back;lb.hidden=false;document.documentElement.classList.add('shot-on');requestAnimationFrame(()=>lb.classList.add('in'));lb.querySelector('.shot-x').focus()}
function shotClose(){const lb=$('#shotLb');if(!lb||lb.hidden)return;lb.classList.remove('in');document.documentElement.classList.remove('shot-on');
  setTimeout(()=>{lb.hidden=true},180);if(lb._back)lb._back.focus({preventScroll:true})}
/* landing motion: sections rise in as they scroll into view; band numbers count up once. Content stays visible without JS. */
function lpFx(){const L=$('#landing');if(!L||L.dataset.fx||!('IntersectionObserver' in window))return;L.dataset.fx=1;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const els=L.querySelectorAll('.lp-sec .lp-in>*,.lp-sc,.sk,.hx-band .lp-in>div');els.forEach(e=>e.classList.add('rv'));
  const io=new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)return;const e=en.target;io.unobserve(e);e.classList.add('in');
    const n=e.querySelector&&e.querySelector('b[data-n]');if(n){const to=+n.dataset.n,t0=performance.now();const f=t=>{const k=Math.min(1,(t-t0)/1100);n.textContent=Math.round(to*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(f)};requestAnimationFrame(f)}}),{rootMargin:'0px 0px -8% 0px'});
  els.forEach(e=>io.observe(e));stkFx()}
/* stacking cards: the card underneath shrinks a little as the next one slides over it (the pile itself is CSS sticky) */
function stkFx(){const S=$('#lpStack');if(!S||G3||S.dataset.fx)return;S.dataset.fx=1;const C=[...S.children];let q=0;
  /* sticky top per card: normally 92px + 14px per card (phones 76 + 10); if a card is taller than the screen,
     top goes up (even negative) so its bottom edge is reached before the next card covers it */
  const T=()=>{const m=innerWidth<=860,H=innerHeight;C.forEach((c,i)=>{const h=c.offsetHeight;if(!h)return;
    const v=Math.min((m?76:92)+i*(m?10:14),H-h-12)+'px';if(c.style.top!==v)c.style.top=v})};
  const f=()=>{q=0;T();for(let i=0;i<C.length-1;i++){if(!C[i].offsetHeight)continue;const a=C[i].getBoundingClientRect(),b=C[i+1].getBoundingClientRect();
    C[i].style.setProperty('--k',Math.max(0,Math.min(1,1-(b.top-a.top)/(C[i].offsetHeight||1))).toFixed(3))}};
  addEventListener('resize',T,{passive:true});if(window.ResizeObserver)new ResizeObserver(T).observe(S);T();
  addEventListener('scroll',()=>{if(!q&&!$('#landing').classList.contains('hide')){q=1;requestAnimationFrame(f)}},{passive:true});f()}
/* ================= ROUTER ================= */
function go(h,replace){if(location.hash===h){route();return}if(replace){history.replaceState(null,'',h);route()}else location.hash=h}
addEventListener('hashchange',route);
function setBack(parent,label){ui.parent=parent;const b=$('#backBtn');b.classList.toggle('hide',!parent);b.innerHTML=`<span class="ar">←</span>${label||'Orqaga'}`}
const view=()=>$('#view');
function route(){
  closeModals();scrollTo(0,0);
  if(location.hash.startsWith('#/c1')&&!G3){showC1();return}
  if(!U){if(location.hash.startsWith('#/login'))showLogin();else showLanding();return}
  const h=location.hash.replace(/^#\/?/,'').split('/');
  if(U.role==='teacher'){
    if(h[0]==='teacher'&&h[1]==='s'&&h[2])teacherStudent(decodeURIComponent(h[2]));
    else teacherHome(h[1]||'students');
    return;
  }
  me(h[0]==='me'?h:['me']);
}

/* ================= COMMON ================= */
const BOOSTER_AID='booster';
const IC={
 map:'<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
 cup:'<svg viewBox="0 0 24 24"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8 21h8M9 18h6"/></svg>',
 lock:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
 check:'<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
 sound:'<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
 mute:'<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>',
 trophy:'<svg viewBox="0 0 24 24"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8 21h8M9 18h6"/></svg>'};
const icon=(k,c)=>`<span class="ic ${c||''}">${IC[k]}</span>`;

/* ---------- sound + vibration + press feedback: the FEEL engine (top of this script; source platform/feel.js) ----------
   sfx() keeps the old names used across this page: tap, open, lock, win, grand, done (+ the new correct / wrong / warn). */
FEEL.init({ns:ST,ambient:true});
const SFX={tap:'tick',open:'open',lock:'deny',win:'success',grand:'celebrate',done:'success'};
function sfx(k){FEEL.play(SFX[k]||k)}
function sndBtn(){const on=FEEL.get('snd');return `<button class="iconbtn sndb" id="sndBtn" aria-label="${on?'Ovozni o‘chirish':'Ovozni yoqish'}" aria-pressed="${on}">${on?IC.sound:IC.mute}</button>`}
function bindSnd(){const b=$('#sndBtn');if(b)b.onclick=()=>{const on=!FEEL.get('snd');FEEL.set('snd',on);b.outerHTML=sndBtn();bindSnd();if(on)FEEL.play('pop')}}

/* ---------- confetti ---------- */
function confetti(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const cv=document.createElement('canvas');cv.className='confetti';document.body.appendChild(cv);const W=cv.width=innerWidth*devicePixelRatio,H=cv.height=innerHeight*devicePixelRatio;const x=cv.getContext('2d');
  const cols=['#E3101F','#141B2D','#F5B700','#1FA35C','#FFFFFF'];const P=Array.from({length:120},()=>({x:W/2+(Math.random()-.5)*W*.2,y:H*.38,vx:(Math.random()-.5)*W*.022,vy:-Math.random()*H*.02-H*.006,s:(6+Math.random()*8)*devicePixelRatio,c:cols[Math.random()*cols.length|0],r:Math.random()*6,vr:(Math.random()-.5)*.3}));
  let f=0;(function tick(){x.clearRect(0,0,W,H);P.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=H*.0009;p.r+=p.vr;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.fillStyle=p.c;x.fillRect(-p.s/2,-p.s/4,p.s,p.s/2);x.restore()});
    if(++f<110)requestAnimationFrame(tick);else cv.remove()})()}

/* ================= BOOSTER ================= */
function bstats(D){
  const tests=(D&&D.tests)||{};const res=[],kw=[];
  for(let i=1;i<=BOOSTER_TESTS;i++){const t=tests[i];if(t&&t.res)res.push([i,t.res]);if(t&&t.kwt&&t.res)kw.push(i)}
  const score=res.reduce((s,[,r])=>s+r.score,0),time=res.reduce((s,[,r])=>s+(r.time||0),0);
  const next=Array.from({length:BOOSTER_TESTS},(_,i)=>i+1).find(i=>!(tests[i]&&tests[i].kwt&&tests[i].res))||null;
  return{read:res.length,complete:kw.length,kw,score,max:res.length*6,acc:res.length?Math.round(score/(res.length*6)*100):null,time,res,next,updated:D&&D.updated,tests};
}
function boosterLink(p,test){
  const s=p.student;
  keepKey(p.k);return BOOSTER_URL+'#sso='+encodeURIComponent(JSON.stringify({id:p.uid||U.id,name:s.name,group:s.group,test:test||null,back:location.href.split('#')[0]+'#/me/a/'+BOOSTER_AID}));
}
const bxp=(p,score)=>((p.rules&&p.rules.base)||10)+((p.rules&&p.rules.perOk)||2)*score;


/* ---------- assignment banners ---------- */
const COVERS={
  booster:{k:'Reading · Part 1',w:'BOOSTER',c1:'#141B2D',c2:'#E3101F',art:'book',l:'Booster'},
  reading:{k:'Reading',w:'MOCK TEST',c1:'#0A2E3A',c2:'#178A8E',art:'lines',l:'Reading'},
  listening:{k:'Listening',w:'PART 2',c1:'#221640',c2:'#7B3FE4',art:'wave',l:'Listening'},
  /* 27.11.2026: the Listening Part 4 / 5 / 6 packs (catalogue lp4, lp5, lp6); not offered as chips in the custom form */
  lp4:{k:'Listening',w:'PART 4',c1:'#221640',c2:'#7B3FE4',art:'wave',l:'Part 4'},
  lp5:{k:'Listening',w:'PART 5',c1:'#221640',c2:'#7B3FE4',art:'wave',l:'Part 5'},
  lp6:{k:'Listening',w:'PART 6',c1:'#221640',c2:'#7B3FE4',art:'wave',l:'Part 6'},
  lmock:{k:'Listening',w:'MOCK TEST',c1:'#1B1036',c2:'#E3101F',art:'wave',l:'Listening'},
  /* 28.11.2026: Listening Part 1 Booster (catalogue lb1, page lb.html); not offered as a chip in the custom form */
  lb1:{k:'Listening · Part 1',w:'BOOSTER',c1:'#141B2D',c2:'#6B3FE0',art:'wave',l:'L1 Booster'},
  lb2:{k:'Listening · Part 2',w:'BOOSTER',c1:'#141B2D',c2:'#6B3FE0',art:'wave',l:'L2 Booster'},
  vocab:{k:'Vocabulary',w:'SO‘ZLAR',c1:'#3D2A00',c2:'#D99A00',art:'dots',l:'Lug‘at'},
  writing:{k:'Writing',w:'ESSAY',c1:'#0E3322',c2:'#1E9A56',art:'lines',l:'Writing'},
  speaking:{k:'Speaking',w:'GAPIR',c1:'#3A0E22',c2:'#D8336A',art:'wave',l:'Speaking'},
  u4a:{k:'Unit 4A · Level 3',w:'HOUSEWORK',c1:'#0B2A4A',c2:'#1C7ED6',art:'dots',l:'4A'},
  u4b:{k:'Unit 4B · Level 3',w:'SHOPPING',c1:'#3D2A00',c2:'#E8590C',art:'lines',l:'4B'},
  u4c:{k:'Unit 4C · Level 3',w:'WEEKENDS',c1:'#0E3322',c2:'#2B9A66',art:'wave',l:'4C'},
  rc34:{k:'Revise & Check',w:'UNITS 3–4',c1:'#2A1046',c2:'#9C36B5',art:'book',l:'R&C'},
  rc14:{k:'Revise & Check · Level 3',w:'UNITS 1–4',c1:'#10233F',c2:'#D9480F',art:'book',l:'R&C 1–4'},
  u5a:{k:'Unit 5A · Level 3',w:'FASTER',c1:'#3A0B12',c2:'#E3101F',art:'wave',l:'5A'},
  u5b:{k:'Unit 5B · Level 3',w:'CITIES',c1:'#1A1446',c2:'#7048E8',art:'lines',l:'5B'},
  rp3:{k:'Reading · Part 3',w:'HEADINGS',c1:'#0A2E3A',c2:'#12A3A8',art:'lines',l:'Part 3'},
  rp2:{k:'Reading · Part 2',w:'MATCHING',c1:'#102A43',c2:'#2F80ED',art:'book',l:'Part 2'},
  wr1:{k:'Writing · Part 1',w:'EMAILS',c1:'#0E3322',c2:'#1E9A56',art:'lines',l:'Writing 1'},
  wr2:{k:'Writing · Part 2',w:'ESSAYS',c1:'#16351C',c2:'#58B83A',art:'book',l:'Writing 2'},
  ai:{k:'Writing',w:'AI CHECK',c1:'#1F1147',c2:'#6C4DF6',art:'dots',l:'AI'},
  grammar:{k:'Grammar',w:'GRAMMATIKA',c1:'#13254A',c2:'#3B6FE0',art:'book',l:'Grammar'}};
/* ---------- ready-made materials (files in this site) ---------- */
const LIB=[{"key":"rm1","title":"Reading · Full Mock Test 1","note":"35 savol · 60 daqiqa · bitta o‘tirishda, oxirida natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Mock Test 1","l":"mashq.html#d=rm1&x=all"}]},{"key":"rm5","title":"Reading · Full Mock Test 5","note":"35 savol · 5 qism · 60 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Mock Test 5","l":"mashq.html#d=rm5&x=all"}]},{"key":"rm12","title":"Reading · Full Mock Test 12","note":"35 savol · 60 daqiqa · har bir savolga o‘zbekcha tahlil va to‘liq tarjima","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Mock Test 12","l":"mashq.html#d=rm12&x=all"}]},{"key":"rm14","title":"Reading · Full Mock Test 14","note":"35 savol · 60 daqiqa · har bir savolga o‘zbekcha tahlil va to‘liq tarjima","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Mock Test 14","l":"mashq.html#d=rm14&x=all"}]},{"key":"rm15","title":"Reading · Full Mock Test 15","note":"35 savol · 60 daqiqa · har bir savolga o‘zbekcha tahlil va to‘liq tarjima","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Mock Test 15","l":"mashq.html#d=rm15&x=all"}]},{"key":"rn1","title":"Reading · Notion Mock Test 1","note":"35 savol · 5 qism · 60 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Notion Mock 1","l":"mashq.html#d=rn1&x=all"}]},{"key":"rn2","title":"Reading · Notion Mock Test 2","note":"35 savol · 5 qism · 60 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Notion Mock 2","l":"mashq.html#d=rn2&x=all"}]},{"key":"rn3","title":"Reading · Notion Mock Test 3","note":"35 savol · 5 qism · 60 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Notion Mock 3","l":"mashq.html#d=rn3&x=all"}]},{"key":"rn4","title":"Reading · Notion Mock Test 4","note":"35 savol · 5 qism · 60 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Notion Mock 4","l":"mashq.html#d=rn4&x=all"}]},{"key":"rt6","title":"Reading · Mock Test 6","note":"35 savol · 5 qism · 60 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Mock Test 6","l":"mashq.html#d=rt6&x=all"}]},{"key":"rt12","title":"Reading · Mock Test 12","note":"35 savol · 5 qism · 60 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"reading","xp":75,"sec":"mock","steps":[{"t":"Reading Mock Test 12","l":"mashq.html#d=rt12&x=all"}]},{"key":"lm01","title":"Listening · Mock Test 1","note":"35 savol · 6 qism · audio 45 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 1","l":"mashq.html#d=lm01&x=all"}]},{"key":"lm02","title":"Listening · Mock Test 2","note":"35 savol · 6 qism · audio 46 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 2","l":"mashq.html#d=lm02&x=all"}]},{"key":"lm03","title":"Listening · Mock Test 3","note":"35 savol · 6 qism · audio 43 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 3","l":"mashq.html#d=lm03&x=all"}]},{"key":"lm04","title":"Listening · Mock Test 4","note":"35 savol · 6 qism · audio 46 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 4","l":"mashq.html#d=lm04&x=all"}]},{"key":"lm05","title":"Listening · Mock Test 5","note":"35 savol · 6 qism · audio 43 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 5","l":"mashq.html#d=lm05&x=all"}]},{"key":"lm06","title":"Listening · Mock Test 6","note":"35 savol · 6 qism · audio 43 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 6","l":"mashq.html#d=lm06&x=all"}]},{"key":"lm07","title":"Listening · Mock Test 7","note":"35 savol · 6 qism · audio 43 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 7","l":"mashq.html#d=lm07&x=all"}]},{"key":"lm08","title":"Listening · Mock Test 8","note":"35 savol · 6 qism · audio 45 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 8","l":"mashq.html#d=lm08&x=all"}]},{"key":"lm09","title":"Listening · Mock Test 9","note":"35 savol · 6 qism · audio 44 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 9","l":"mashq.html#d=lm09&x=all"}]},{"key":"lm10","title":"Listening · Mock Test 10","note":"35 savol · 6 qism · audio 44 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mock Test 10","l":"mashq.html#d=lm10&x=all"}]},{"key":"nm1","title":"Listening · Notion Mock 1","note":"35 savol · 6 qism · audio 46 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Notion Mock 1","l":"mashq.html#d=nm1&x=all"}]},{"key":"nm2","title":"Listening · Notion Mock 2","note":"35 savol · 6 qism · audio 46 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Notion Mock 2","l":"mashq.html#d=nm2&x=all"}]},{"key":"nm3","title":"Listening · Notion Mock 3","note":"35 savol · 6 qism · audio 46 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Notion Mock 3","l":"mashq.html#d=nm3&x=all"}]},{"key":"nm4","title":"Listening · Notion Mock 4","note":"35 savol · 6 qism · audio 44 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Notion Mock 4","l":"mashq.html#d=nm4&x=all"}]},{"key":"ml1","title":"Listening · Mood Mock Test 1","note":"35 savol · 6 qism · audio 36 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mood Mock Test 1","l":"mashq.html#d=ml1&x=all"}]},{"key":"ml2","title":"Listening · Mood Mock Test 2","note":"35 savol · 6 qism · audio 33 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mood Mock Test 2","l":"mashq.html#d=ml2&x=all"}]},{"key":"ml4","title":"Listening · Mood Mock Test 4","note":"35 savol · 6 qism · audio 32 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mood Mock Test 4","l":"mashq.html#d=ml4&x=all"}]},{"key":"ml8","title":"Listening · Mood Mock Test 8","note":"35 savol · 6 qism · audio 36 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mood Mock Test 8","l":"mashq.html#d=ml8&x=all"}]},{"key":"ml9","title":"Listening · Mood Mock Test 9","note":"35 savol · 6 qism · audio 34 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mood Mock Test 9","l":"mashq.html#d=ml9&x=all"}]},{"key":"ml13","title":"Listening · Mood Mock Test 13","note":"35 savol · 6 qism · audio 39 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Mood Mock Test 13","l":"mashq.html#d=ml13&x=all"}]},{"key":"lf19","title":"Listening · Full Mock Test 19","note":"35 savol · 6 qism · audio 37 daqiqa · bitta o‘tirishda, natija va sertifikat","cover":"lmock","xp":75,"sec":"mock","steps":[{"t":"Listening Full Mock Test 19","l":"mashq.html#d=lf19&x=all"}]},{"key":"rp3","title":"Reading Part 3 · Sarlavhalar","note":"12 ta matn: sarlavha tanlash, tahlil va tarjima bilan","cover":"rp3","xp":15,"sec":"reading","steps":[{"t":"1. The End of Cash? (B1–B2)","l":"mashq.html#d=rp3&x=e1"},{"t":"2. The Second Life of Things (B1–B2)","l":"mashq.html#d=rp3&x=e2"},{"t":"3. The Future of Small Local Shops (B1–B2)","l":"mashq.html#d=rp3&x=e3"},{"t":"4. The Truth About Loyalty Cards (B1–B2)","l":"mashq.html#d=rp3&x=e4"},{"t":"5. Starting a Business from Your Bedroom (B1–B2)","l":"mashq.html#d=rp3&x=e5"},{"t":"6. The Changing World of Shopping (B1–B2)","l":"mashq.html#d=rp3&x=e6"},{"t":"7. The Hidden Science of Prices (B2–C1)","l":"mashq.html#d=rp3&x=e7"},{"t":"8. Living on Subscription (B2–C1)","l":"mashq.html#d=rp3&x=e8"},{"t":"9. The Changing World of Shopping (B2–C1)","l":"mashq.html#d=rp3&x=e9"},{"t":"10. Green Spaces (B2–C1)","l":"mashq.html#d=rp3&x=e10"},{"t":"11. Slow Travel: When Less Can Mean More","l":"mashq.html#d=rp3&x=e11"},{"t":"12. Beyond the Classroom: What School Really Teaches Us","l":"mashq.html#d=rp3&x=e12"}]},{"key":"rp3p1","title":"Reading Part 3 · Pack 1","note":"28 ta matn (A2–C1): sarlavha tanlash, tahlil va tarjima bilan","cover":"rp3","xp":5,"sec":"reading","steps":[{"t":"1. Life on a Space Station (A2)","l":"mashq.html#d=rp3p1&x=e1"},{"t":"2. The Emperor Penguin (A2)","l":"mashq.html#d=rp3p1&x=e2"},{"t":"3. Street Food Around the World (A2)","l":"mashq.html#d=rp3p1&x=e3"},{"t":"4. A Village Without Roads (A2)","l":"mashq.html#d=rp3p1&x=e4"},{"t":"5. The Story of Chocolate (A2)","l":"mashq.html#d=rp3p1&x=e5"},{"t":"6. A Hotel Made of Ice (A2)","l":"mashq.html#d=rp3p1&x=e6"},{"t":"7. Dogs with Important Jobs (A2)","l":"mashq.html#d=rp3p1&x=e7"},{"t":"8. Why Do We Yawn? (B1)","l":"mashq.html#d=rp3p1&x=e8"},{"t":"9. The Great Wall of China (B1)","l":"mashq.html#d=rp3p1&x=e9"},{"t":"10. A Month Without a Smartphone (B1)","l":"mashq.html#d=rp3p1&x=e10"},{"t":"11. The Clever Octopus (B1)","l":"mashq.html#d=rp3p1&x=e11"},{"t":"12. The Tiny House Movement (B1)","l":"mashq.html#d=rp3p1&x=e12"},{"t":"13. The Secret Language of Bees (B1)","l":"mashq.html#d=rp3p1&x=e13"},{"t":"14. The Birth of the Bicycle (B1)","l":"mashq.html#d=rp3p1&x=e14"},{"t":"15. The Psychology of Waiting (B2)","l":"mashq.html#d=rp3p1&x=e15"},{"t":"16. Coral Reefs in Danger (B2)","l":"mashq.html#d=rp3p1&x=e16"},{"t":"17. The True Cost of Fast Fashion (B2)","l":"mashq.html#d=rp3p1&x=e17"},{"t":"18. The Power of the Placebo (B2)","l":"mashq.html#d=rp3p1&x=e18"},{"t":"19. Farming in the Sky (B2)","l":"mashq.html#d=rp3p1&x=e19"},{"t":"20. Why Music Gives Us Chills (B2)","l":"mashq.html#d=rp3p1&x=e20"},{"t":"21. The Science of Putting Things Off (B2)","l":"mashq.html#d=rp3p1&x=e21"},{"t":"22. Bringing Back the Lost (C1)","l":"mashq.html#d=rp3p1&x=e22"},{"t":"23. The Gentle Push (C1)","l":"mashq.html#d=rp3p1&x=e23"},{"t":"24. Working by the Task (C1)","l":"mashq.html#d=rp3p1&x=e24"},{"t":"25. The Silencing of Languages (C1)","l":"mashq.html#d=rp3p1&x=e25"},{"t":"26. When Visitors Become Too Many (C1)","l":"mashq.html#d=rp3p1&x=e26"},{"t":"27. The Forgotten Organ (C1)","l":"mashq.html#d=rp3p1&x=e27"},{"t":"28. The Unreliable Witness (C1)","l":"mashq.html#d=rp3p1&x=e28"}]},{"key":"rp2b1","title":"Reading Part 2 · B1 Pack 1","note":"7 ta mashq: 5 kishi va 8 ta matn, izohlar bilan","cover":"rp2","xp":10,"sec":"reading","steps":[{"t":"1. Department Stores","l":"mashq.html#d=rp2b1&x=e1"},{"t":"2. Art Courses","l":"mashq.html#d=rp2b1&x=e2"},{"t":"3. Film Studios","l":"mashq.html#d=rp2b1&x=e3"},{"t":"4. Reviews of Animated Films","l":"mashq.html#d=rp2b1&x=e4"},{"t":"5. Geography Websites","l":"mashq.html#d=rp2b1&x=e5"},{"t":"6. Beaches","l":"mashq.html#d=rp2b1&x=e6"},{"t":"7. Museums","l":"mashq.html#d=rp2b1&x=e7"}]},{"key":"lb1","title":"Listening Part 1 Booster","note":"4 ta test · har birida 5 bosqich (A–E), tahlil va tuzoqlar bilan","cover":"lb1","xp":20,"sec":"listening","steps":[{"t":"Test 1 · Full Mock 15-Bagdad","l":"lb.html#d=lb1&x=t15"},{"t":"Test 2 · Full Mock 17-Bagdad","l":"lb.html#d=lb1&x=t17"},{"t":"Test 3 · Full Mock 22-Bagdad","l":"lb.html#d=lb1&x=t22"},{"t":"Test 4 · Full Mock 23-Bagdad","l":"lb.html#d=lb1&x=t23"}]},{"key":"lb2","title":"Listening Part 2 Booster","note":"4 ta test · har birida 5 bosqich (A–E), audio matni va tahlil bilan","cover":"lb2","xp":20,"sec":"listening","steps":[{"t":"Test 1 · Full Mock 15-Bagdad","l":"lb.html#d=lb2&x=t15"},{"t":"Test 2 · Full Mock 17-Bagdad","l":"lb.html#d=lb2&x=t17"},{"t":"Test 3 · Full Mock 22-Bagdad","l":"lb.html#d=lb2&x=t22"},{"t":"Test 4 · Full Mock 23-Bagdad","l":"lb.html#d=lb2&x=t23"}]},{"key":"lp4","title":"Listening Part 4 Pack","note":"2 ta Map Vocabulary va 8 ta mashq · audio, javob tekshiruvi va skript","cover":"lp4","xp":10,"sec":"listening","steps":[{"t":"Map Vocabulary 1","l":"mashq.html#d=lp4&x=v1"},{"t":"Map Vocabulary 2","l":"mashq.html#d=lp4&x=v2"},{"t":"Exercise 1","l":"mashq.html#d=lp4&x=e1"},{"t":"Exercise 2","l":"mashq.html#d=lp4&x=e2"},{"t":"Exercise 3","l":"mashq.html#d=lp4&x=e3"},{"t":"Exercise 4","l":"mashq.html#d=lp4&x=e4"},{"t":"Exercise 5","l":"mashq.html#d=lp4&x=e5"},{"t":"Exercise 6","l":"mashq.html#d=lp4&x=e6"},{"t":"Exercise 7","l":"mashq.html#d=lp4&x=e7"},{"t":"Exercise 8","l":"mashq.html#d=lp4&x=e8"}]},{"key":"lp5","title":"Listening Part 5 Pack","note":"9 ta mashq (3-mashq 3 qismda) · audio, javob tekshiruvi va skript","cover":"lp5","xp":10,"sec":"listening","steps":[{"t":"Exercise 1","l":"mashq.html#d=lp5&x=e1"},{"t":"Exercise 2","l":"mashq.html#d=lp5&x=e2"},{"t":"Exercise 3 · Extract One","l":"mashq.html#d=lp5&x=e3a"},{"t":"Exercise 3 · Extract Two","l":"mashq.html#d=lp5&x=e3b"},{"t":"Exercise 3 · Extract Three","l":"mashq.html#d=lp5&x=e3c"},{"t":"Exercise 4","l":"mashq.html#d=lp5&x=e4"},{"t":"Exercise 5","l":"mashq.html#d=lp5&x=e5"},{"t":"Exercise 6","l":"mashq.html#d=lp5&x=e6"},{"t":"Exercise 7","l":"mashq.html#d=lp5&x=e7"},{"t":"Exercise 8","l":"mashq.html#d=lp5&x=e8"},{"t":"Exercise 9","l":"mashq.html#d=lp5&x=e9"}]},{"key":"lp6","title":"Listening Part 6 Pack","note":"11 ta mashq · audio, javob tekshiruvi va skript","cover":"lp6","xp":10,"sec":"listening","steps":[{"t":"1. Bioluminescence: Light in the Deep Ocean","l":"mashq.html#d=lp6&x=e1"},{"t":"2. The Search for Water on Mars","l":"mashq.html#d=lp6&x=e2"},{"t":"3. The Marketing Industry","l":"mashq.html#d=lp6&x=e3"},{"t":"4. Taming and Domestication of Wild Animals","l":"mashq.html#d=lp6&x=e4"},{"t":"5. Green Urbanisation","l":"mashq.html#d=lp6&x=e5"},{"t":"6. Screen Time and Mental Wellbeing","l":"mashq.html#d=lp6&x=e6"},{"t":"7. Charlie Chaplin","l":"mashq.html#d=lp6&x=e7"},{"t":"8. Synaesthesia","l":"mashq.html#d=lp6&x=e8"},{"t":"9. The Decline of Honeybees","l":"mashq.html#d=lp6&x=e9"},{"t":"10. The History and Science of Tea","l":"mashq.html#d=lp6&x=e10"},{"t":"11. Human Missions to Mars","l":"mashq.html#d=lp6&x=e11"}]},{"key":"voc1","title":"Lug‘at · Speaking iboralari","note":"60 ta ibora: tarjima, misollar, Speaking javoblari va 2 ta mashq","cover":"vocab","xp":10,"sec":"vocab","steps":[{"t":"Free Time: Collocations","l":"mashq.html#d=voc1&x=ft1"},{"t":"Free Time: Phrasal verbs","l":"mashq.html#d=voc1&x=ft2"},{"t":"Free Time: Mashq","l":"mashq.html#d=voc1&x=ftx"},{"t":"Character: Adjectives va Idioms","l":"mashq.html#d=voc1&x=cp1"},{"t":"Character: Collocations","l":"mashq.html#d=voc1&x=cp2"},{"t":"Work and Study: Collocations","l":"mashq.html#d=voc1&x=ws1"},{"t":"Work and Study: Phrasal verbs","l":"mashq.html#d=voc1&x=ws2"},{"t":"Work and Study: Mashq","l":"mashq.html#d=voc1&x=wsx"}]},{"key":"adj1","title":"Lug‘at · 100 Advanced Adjectives B2 - C1","note":"100 ta sifat: o‘zbekcha tarjima va sinonimlar (B2 va C1)","cover":"vocab","xp":10,"sec":"vocab","steps":[{"t":"B2 Adjectives · 1–25","l":"mashq.html#d=adj1&x=b1"},{"t":"B2 Adjectives · 26–50","l":"mashq.html#d=adj1&x=b2"},{"t":"C1 Adjectives · 51–75","l":"mashq.html#d=adj1&x=c1"},{"t":"C1 Adjectives · 76–100","l":"mashq.html#d=adj1&x=c2"}]},{"key":"wr1","title":"Writing Part 1 · 30 savol","note":"Har bir savolga 1.1 va 1.2 namuna javob (60 ta)","cover":"wr1","xp":5,"sec":"writing","steps":[{"t":"1. School Dormitory Rules","l":"mashq.html#d=wr1&x=q1"},{"t":"2. Earlier Study Room Closing","l":"mashq.html#d=wr1&x=q2"},{"t":"3. Cinema Screening and Ticket Changes","l":"mashq.html#d=wr1&x=q3"},{"t":"4. Museum Exhibition Space","l":"mashq.html#d=wr1&x=q4"},{"t":"5. Library Books and Computer Room","l":"mashq.html#d=wr1&x=q5"},{"t":"6. School Canteen Menu","l":"mashq.html#d=wr1&x=q6"},{"t":"7. Sports Club Booking Policy","l":"mashq.html#d=wr1&x=q7"},{"t":"8. Public Park Facilities","l":"mashq.html#d=wr1&x=q8"},{"t":"9. Language School Class Timetable","l":"mashq.html#d=wr1&x=q9"},{"t":"10. University Shuttle Service","l":"mashq.html#d=wr1&x=q10"},{"t":"11. Community Centre Weekend Activities","l":"mashq.html#d=wr1&x=q11"},{"t":"12. School Playground Redesign","l":"mashq.html#d=wr1&x=q12"},{"t":"13. Swimming Pool Timetable","l":"mashq.html#d=wr1&x=q13"},{"t":"14. Bookshop Reading Events","l":"mashq.html#d=wr1&x=q14"},{"t":"15. College Career Centre","l":"mashq.html#d=wr1&x=q15"},{"t":"16. Museum History Exhibition","l":"mashq.html#d=wr1&x=q16"},{"t":"17. School Mountain Trip","l":"mashq.html#d=wr1&x=q17"},{"t":"18. Cinema Film Festival","l":"mashq.html#d=wr1&x=q18"},{"t":"19. University Career Day","l":"mashq.html#d=wr1&x=q19"},{"t":"20. Community Sports Tournament","l":"mashq.html#d=wr1&x=q20"},{"t":"21. Library Author Workshop","l":"mashq.html#d=wr1&x=q21"},{"t":"22. Outdoor Music Evening","l":"mashq.html#d=wr1&x=q22"},{"t":"23. School Science Fair","l":"mashq.html#d=wr1&x=q23"},{"t":"24. Hotel Guest Experience","l":"mashq.html#d=wr1&x=q24"},{"t":"25. Restaurant Service Review","l":"mashq.html#d=wr1&x=q25"},{"t":"26. School Library Experience","l":"mashq.html#d=wr1&x=q26"},{"t":"27. Fitness Centre Facilities","l":"mashq.html#d=wr1&x=q27"},{"t":"28. Online Learning Platform","l":"mashq.html#d=wr1&x=q28"},{"t":"29. Local Bus Service","l":"mashq.html#d=wr1&x=q29"},{"t":"30. School Sports Day","l":"mashq.html#d=wr1&x=q30"}]},{"key":"wr1d","title":"Writing Part 1 · December Practice","note":"15 ta savol: har birida Part 1.1 va Part 1.2","cover":"wr1","xp":5,"sec":"writing","steps":[{"t":"1. Evening access at the public library","l":"mashq.html#d=wr1d&x=q1"},{"t":"2. The winter climbing trip","l":"mashq.html#d=wr1d&x=q2"},{"t":"3. The museum audio guide","l":"mashq.html#d=wr1d&x=q3"},{"t":"4. A new pickup point for food boxes","l":"mashq.html#d=wr1d&x=q4"},{"t":"5. The cancelled repair workshop","l":"mashq.html#d=wr1d&x=q5"},{"t":"6. Lunch at the training centre","l":"mashq.html#d=wr1d&x=q6"},{"t":"7. Changes to a language exchange","l":"mashq.html#d=wr1d&x=q7"},{"t":"8. The school theatre performance","l":"mashq.html#d=wr1d&x=q8"},{"t":"9. The neighbourhood seed exchange","l":"mashq.html#d=wr1d&x=q9"},{"t":"10. A different route for the winter walk","l":"mashq.html#d=wr1d&x=q10"},{"t":"11. The cancelled careers visit","l":"mashq.html#d=wr1d&x=q11"},{"t":"12. The trial bus service","l":"mashq.html#d=wr1d&x=q12"},{"t":"13. Opening hours at the ceramics studio","l":"mashq.html#d=wr1d&x=q13"},{"t":"14. The cancelled riverside clean-up","l":"mashq.html#d=wr1d&x=q14"},{"t":"15. A trial booking system at the music centre","l":"mashq.html#d=wr1d&x=q15"}]},{"key":"wr2","title":"Writing Part 2 · 60 mavzu","note":"15 yo‘nalish, har bir savolga C1 namuna (180–200 so‘z)","cover":"wr2","xp":10,"sec":"writing","steps":[{"t":"1. Education","l":"mashq.html#d=wr2&x=t1"},{"t":"2. Technology","l":"mashq.html#d=wr2&x=t2"},{"t":"3. Environment","l":"mashq.html#d=wr2&x=t3"},{"t":"4. Transport & Cities","l":"mashq.html#d=wr2&x=t4"},{"t":"5. Health & Lifestyle","l":"mashq.html#d=wr2&x=t5"},{"t":"6. Society & Youth","l":"mashq.html#d=wr2&x=t6"},{"t":"7. Culture & Traditions","l":"mashq.html#d=wr2&x=t7"},{"t":"8. Business & Work","l":"mashq.html#d=wr2&x=t8"},{"t":"9. Global Issues","l":"mashq.html#d=wr2&x=t9"},{"t":"10. Art & Media","l":"mashq.html#d=wr2&x=t10"},{"t":"11. Family & Community","l":"mashq.html#d=wr2&x=t11"},{"t":"12. Animals & Nature","l":"mashq.html#d=wr2&x=t12"},{"t":"13. Tourism & Travel","l":"mashq.html#d=wr2&x=t13"},{"t":"14. Food & Consumption","l":"mashq.html#d=wr2&x=t14"},{"t":"15. Work & Future","l":"mashq.html#d=wr2&x=t15"}]},{"key":"wps1","title":"Writing Part 2 · Problem - Solution","note":"Shablon, namunalar va bitta yozish mashqi (180–200 so‘z)","cover":"wr2","xp":10,"sec":"writing","steps":[{"t":"Shablon va namunalar","l":"mashq.html#d=wps1&x=n1"},{"t":"Mashq: Air pollution","l":"mashq.html#d=wps1&x=w1"}]},{"key":"gr1","title":"Grammatika · Past Simple, Would - Used to","note":"Dars: qoida, formula, misollar va mini-testlar + 5 ta mashq (javob va tahlil bilan)","cover":"grammar","xp":10,"sec":"other","steps":[{"t":"Dars: Past Simple, Would - Used to","l":"grammar.html#d=gr1&x=n1"},{"t":"Mashq 1 · Past Simple: darak shakli","l":"grammar.html#d=gr1&x=m1"},{"t":"Mashq 2 · Past Simple: inkor va so‘roq","l":"grammar.html#d=gr1&x=m2"},{"t":"Mashq 3 · Used to","l":"grammar.html#d=gr1&x=m3"},{"t":"Mashq 4 · Would yoki used to?","l":"grammar.html#d=gr1&x=m4"},{"t":"Mashq 5 · Past Simple, would yoki used to?","l":"grammar.html#d=gr1&x=m5"}]},{"key":"gr2","title":"Grammatika · Future Simple","note":"Dars: qoida, formula va misollar + 5 ta mashq (javob va tahlil bilan)","cover":"grammar","xp":10,"sec":"other","steps":[{"t":"Dars: Future Simple","l":"grammar.html#d=gr2&x=n1"},{"t":"Mashq 1 · Future Simple: darak shakli","l":"grammar.html#d=gr2&x=m1"},{"t":"Mashq 2 · Future Simple: inkor va so‘roq","l":"grammar.html#d=gr2&x=m2"},{"t":"Mashq 3 · Future Simple: qaysi holat?","l":"grammar.html#d=gr2&x=m3"},{"t":"Mashq 4 · Will you, Shall I yoki Shall we?","l":"grammar.html#d=gr2&x=m4"},{"t":"Mashq 5 · Future Simple: gap tuzing","l":"grammar.html#d=gr2&x=m5"}]},{"key":"gr3","title":"Grammatika · Future Continuous","note":"Dars: qoida, formula va misollar + 4 ta mashq (javob va tahlil bilan)","cover":"grammar","xp":10,"sec":"other","steps":[{"t":"Dars: Future Continuous","l":"grammar.html#d=gr3&x=n1"},{"t":"Mashq 1 · Future Continuous: will be + Verb-ing","l":"grammar.html#d=gr3&x=m1"},{"t":"Mashq 2 · Future Continuous: to‘g‘ri shaklni tanlang","l":"grammar.html#d=gr3&x=m2"},{"t":"Mashq 3 · Future Continuous: Time Expressions","l":"grammar.html#d=gr3&x=m3"},{"t":"Mashq 4 · Future Continuous: gap tuzing","l":"grammar.html#d=gr3&x=m4"}]},{"key":"gr4","title":"Grammatika · Present Perfect Continuous","note":"Dars: qoida, formula va misollar + 4 ta mashq (javob va tahlil bilan)","cover":"grammar","xp":10,"sec":"other","steps":[{"t":"Dars: Present Perfect Continuous","l":"grammar.html#d=gr4&x=n1"},{"t":"Mashq 1 · Present Perfect Continuous: have / has + been + Verb-ing","l":"grammar.html#d=gr4&x=m1"},{"t":"Mashq 2 · For yoki since?","l":"grammar.html#d=gr4&x=m2"},{"t":"Mashq 3 · Present Perfect Continuous: to‘g‘ri shaklni tanlang","l":"grammar.html#d=gr4&x=m3"},{"t":"Mashq 4 · Present Perfect Continuous: gap tuzing","l":"grammar.html#d=gr4&x=m4"}]},{"key":"gr5","title":"Grammatika · Past Continuous","note":"Dars: qoida, formula va misollar + 6 ta mashq (javob va tahlil bilan)","cover":"grammar","xp":10,"sec":"other","steps":[{"t":"Dars: Past Continuous","l":"grammar.html#d=gr5&x=n1"},{"t":"Mashq 1 · Past Continuous: was / were + Verb ing","l":"grammar.html#d=gr5&x=m1"},{"t":"Mashq 2 · Past Continuous: inkor va so‘roq","l":"grammar.html#d=gr5&x=m2"},{"t":"Mashq 3 · When: Past Continuous + Past Simple (2-holat)","l":"grammar.html#d=gr5&x=m3"},{"t":"Mashq 4 · While: bir vaqtda davom etgan ish-harakatlar (3-holat)","l":"grammar.html#d=gr5&x=m4"},{"t":"Mashq 5 · Past Continuous: qaysi holat?","l":"grammar.html#d=gr5&x=m5"},{"t":"Mashq 6 · Past Continuous: gap tuzing","l":"grammar.html#d=gr5&x=m6"}]},{"key":"iv1","title":"Grammatika · Noto‘g‘ri fe’llar jadvali","note":"200 ta fe’l: 3 ta shakli va o‘zbekcha tarjimasi (A1–A2, B1, B2) + 8 ta mashq","cover":"grammar","xp":10,"sec":"other","steps":[{"t":"A1–A2 · 1–25","l":"mashq.html#d=iv1&x=s1"},{"t":"Mashq: A1–A2 · 1–25","l":"grammar.html#d=iv1x&x=m1"},{"t":"A1–A2 · 26–50","l":"mashq.html#d=iv1&x=s2"},{"t":"Mashq: A1–A2 · 26–50","l":"grammar.html#d=iv1x&x=m2"},{"t":"A1–A2 · 51–75","l":"mashq.html#d=iv1&x=s3"},{"t":"Mashq: A1–A2 · 51–75","l":"grammar.html#d=iv1x&x=m3"},{"t":"A1–A2 · 76–100","l":"mashq.html#d=iv1&x=s4"},{"t":"Mashq: A1–A2 · 76–100","l":"grammar.html#d=iv1x&x=m4"},{"t":"B1 · 101–125","l":"mashq.html#d=iv1&x=s5"},{"t":"Mashq: B1 · 101–125","l":"grammar.html#d=iv1x&x=m5"},{"t":"B1 · 126–150","l":"mashq.html#d=iv1&x=s6"},{"t":"Mashq: B1 · 126–150","l":"grammar.html#d=iv1x&x=m6"},{"t":"B2 · 151–175","l":"mashq.html#d=iv1&x=s7"},{"t":"Mashq: B2 · 151–175","l":"grammar.html#d=iv1x&x=m7"},{"t":"B2 · 176–200","l":"mashq.html#d=iv1&x=s8"},{"t":"Mashq: B2 · 176–200","l":"grammar.html#d=iv1x&x=m8"}]},{"key":"sp3a","title":"Speaking Part 3 · Space exploration","note":"Governments should stop spending money on space exploration: FOR / AGAINST, paraphrasing va javob tuzilmasi","cover":"speaking","xp":5,"sec":"other","steps":[{"t":"Governments should stop spending money on space exploration","l":"mashq.html#d=sp3a&x=n1"}]}];
const isSoon=a=>!!(a&&a.steps&&a.steps.length===1&&a.steps[0].l==='soon');   /* an old placeholder row (its only step is 'soon'): never shown to anyone */
const isExam=l=>/^mashq\.html#(?:.*&)?x=all(?:&|$)/.test(l||'');
const examDoc=l=>{const m=/^mashq\.html#(?:.*&)?d=([a-z0-9-]+)/.exec(l||'');return m?m[1]:''};
/* the start page of a material: mashq.html#d=<doc> (menu), grammar.html#d=<doc> (topic page) or lb.html#d=<doc> (booster home) */
const docHome=l=>{const m=/^(mashq|grammar|lb)\.html#(?:.*&)?d=([a-z0-9-]+)/.exec(l||'');return m?m[1]+'.html#d='+m[2]:l};
function examRes(l){if(!isExam(l)||!U||!U.id)return null;try{const x=JSON.parse(store(ST+'mashq:'+U.id+':'+examDoc(l)+':exam')||'null');return (x&&x.r)||null}catch(e){return null}}
const resText=r=>r?`${r.ok}/${r.of} · ${r.ball} ball · ${r.lv||'B1 dan past'}`:'';
/* General English 3 (since 26.11.2026): sections are the book's units (from the banner: u5a → Unit 5), newest first, then revision and grammar */
const SECS=G3?[...[9,8,7,6,5,4,3,2,1].map(n=>['u'+n,'Unit '+n]),['rev','Takrorlash'],['grammar','Grammatika'],['other','Boshqa topshiriqlar']]
  :[['mock','Mock testlar'],['reading','Reading'],['listening','Listening'],['writing','Writing'],['vocab','Lug‘at'],['grammar','Grammatika'],['other','Boshqa topshiriqlar']];
const secOf=G3?t=>{const c=t.cover||'',m=/^u(\d)/.exec(c);return m?'u'+m[1]:/^rc/.test(c)?'rev':c==='grammar'?'grammar':'other'}
  :t=>t.steps.some(x=>isExam(x.l))?'mock':t.booster?'reading':({reading:'reading',rp3:'reading',rp2:'reading',listening:'listening',lp4:'listening',lp5:'listening',lp6:'listening',lb1:'listening',lb2:'listening',vocab:'vocab',wr1:'writing',wr2:'writing',writing:'writing',grammar:'grammar'}[t.cover]||'other');
function coverArt(a){
  if(a==='wave')return `<svg class="cart" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">${Array.from({length:34},(_,i)=>{const h=8+Math.abs(Math.sin(i*.55)*Math.cos(i*.21))*62;return `<rect x="${i*6}" y="${40-h/2}" width="3" height="${h}" rx="1.5"/>`}).join('')}</svg>`;
  if(a==='lines')return `<svg class="cart cart-r" viewBox="0 0 200 80" preserveAspectRatio="xMaxYMid meet" aria-hidden="true"><rect x="70" y="4" width="110" height="74" rx="6" fill="none" stroke-width="3"/>${Array.from({length:7},(_,i)=>`<rect x="${i%3?90:84}" y="${14+i*9}" width="${60+((i*29)%30)}" height="3" rx="1.5"/>`).join('')}</svg>`;
  if(a==='dots')return `<svg class="cart" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">${Array.from({length:40},(_,i)=>`<circle cx="${(i%10)*20+10}" cy="${Math.floor(i/10)*20+10}" r="${2+(i*7)%5}"/>`).join('')}</svg>`;
  return `<svg class="cart" viewBox="0 0 200 80" preserveAspectRatio="xMaxYMid meet" aria-hidden="true"><path d="M110 18c22-8 44-8 66 0v52c-22-8-44-8-66 0zM110 18c-22-8-44-8-66 0v52c22-8 44-8 66 0z" fill="none" stroke-width="4"/><path d="M60 30h36M60 42h36M124 30h36M124 42h36" stroke-width="3"/></svg>`;
}
function coverHTML(key,i,extra,cv){   /* cv: an explicit cover (landing only), else COVERS[key] */
  const c=cv||COVERS[key]||{k:'Topshiriq',w:'MASHQ',c1:`hsl(${(i*53+200)%360} 45% 22%)`,c2:`hsl(${(i*53+230)%360} 60% 46%)`,art:'dots'};
  return `<div class="tcov" style="--c1:${c.c1};--c2:${c.c2}">${coverArt(c.art)}<span class="ck">${esc(c.k)}</span><b class="cw">${esc(c.w)}</b>${extra||''}</div>`;
}
/* ================= ASSIGNMENT MODEL (Booster + teacher maps) ================= */
function tracks(p){
  const st=bstats(p.booster);
  const b={aid:BOOSTER_AID,title:'Reading Part 1 Booster',sub:'30 ta matn, har birida A–E mashqlari',booster:true,cover:'booster',
    steps:Array.from({length:BOOSTER_TESTS},(_,i)=>{const t=st.tests[i+1];const done=!!(t&&t.kwt&&t.res);
      return{t:'Test '+(i+1),done,score:t&&t.res?t.res.score:null,xp:done?bxp(p,t.res.score):null,pack:Math.floor(i/10)+1}})};
  const own=(p.assignments||[]).filter(mineA).filter(a=>!isSoon(a)).map(a=>({aid:a.aid,title:a.title,sub:a.note||'',xpEach:a.xp,cover:a.cover||'',
    steps:a.steps.map((s,i)=>({t:s.t||('Bosqich '+(i+1)),l:s.l,done:((p.progress||{})[a.aid+':'+i])==='done',xp:a.xp,info:((p.info||{})[a.aid+':'+i])||''}))}));
  return (G3?own:[b,...own]).map(t=>{const d=t.steps.filter(s=>s.done).length;const cur=t.steps.findIndex(s=>!s.done);return{...t,done:d,total:t.steps.length,cur,finished:d===t.steps.length}});
}

/* ================= STUDENT ================= */
const STABS=[['home','Topshiriqlar',IC.map],['liga','Reyting',IC.cup],['profil','Profil','<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>']];
const meQ=()=>({action:'me',id:U.id,t:U.t,v:'ml'});   /* v=ml: the server counts today as a day on the platform (General English 3 too, since 26.11.2026) */
let lastFetch=0;
async function me(h){
  if(h[1]==='b'&&h[2]){if(!P){try{P=JSON.parse(store(ST+'p:'+U.id)||'null')}catch(e){}}if(P&&!P.xp)P=null;
    if(!P){view().innerHTML='<div class="wrap"><div class="loading" style="margin-top:60px"><div class="spin"></div>Yuklanmoqda…</div></div>';
      try{const j=await cget(meQ());if(j&&j.ok){lastFetch=Date.now();P=qApply(j);keepKey(j.k);store(ST+'p:'+U.id,JSON.stringify(P))}}catch(e){}}
    if(!P){go('#/me',true);return}bxOpen(+h[2]);return}
  if(h[1]==='a'&&h[3]==='done'&&h[4]!=null){ui.pendingDone={aid:decodeURIComponent(h[2]),i:+h[4]};history.replaceState(null,'','#/me/a/'+h[2]);h=h.slice(0,3)}
  const tab=h[1]==='liga'?'liga':h[1]==='profil'?'profil':h[1]==='a'&&h[2]?'map':'home';ui.stab=tab;ui.aid=h[2]&&decodeURIComponent(h[2]);
  document.body.classList.add('st-mode');setBack(tab==='map'?'#/me':null,'Topshiriqlar');
  if(!P){try{P=JSON.parse(store(ST+'p:'+U.id)||'null')}catch(e){}}
  if(P&&!P.xp)P=null;
  if(P)drawMe();else view().innerHTML='<div class="wrap"><div class="loading" style="margin-top:60px"><div class="spin"></div>Yuklanmoqda…</div></div>';
  if(Date.now()-lastFetch<15000&&P)return;
  try{const j=await cget(meQ());lastFetch=Date.now();
    if(j&&j.ok){P=qApply(j);keepKey(j.k);store(ST+'p:'+U.id,JSON.stringify(P));if(location.hash.startsWith('#/me'))drawMe();qFlush();bxFlush();rqFlush()}
    else if(j&&!j.ok){toast(U.guest?'Mehmon muddati tugadi. Qaytadan kiring.':'Qaytadan kiring');logout(true)}}
  catch(e){if(!P)view().innerHTML=`<div class="wrap"><div class="card sec"><h3>Internet aloqasi yo‘q</h3><p class="muted">Aloqani tekshirib, qayta urinib ko‘ring.</p><button class="btn red big" onclick="lastFetch=0;route()">Qayta urinish</button></div></div>`}
}
function stNav(tab){return `<nav class="stnav ${STABS.length===2?'two':'three'}" aria-label="Bo‘limlar">${STABS.map(([k,l,ic])=>`<a href="#/me${k==='home'?'':'/'+k}" class="${k===tab||(tab==='map'&&k==='home')?'on':''}">${ic}<span>${l}</span></a>`).join('')}</nav>`}
function drawMe(){
  const tab=ui.stab;
  if(tab==='map'){const t=tracks(P).find(x=>x.aid===ui.aid);if(!t){go('#/me',true);return}view().innerHTML=mapHTML(P,t)+stNav(tab);bindMap(P,t);
    const pd=ui.pendingDone;if(pd&&pd.aid===t.aid){ui.pendingDone=null;const st=t.steps[pd.i];
      if(st&&!st.done&&!t.booster&&pd.i===t.cur){const pf=stepProof(st.l);if(!pf.ok)toast(pf.msg);else stepMark(P,t,pd.i,'done',pf.info)}
      else if(st&&st.done&&isExam(st.l)){const inf=resText(examRes(st.l));if(inf&&inf!==st.info){P.info=P.info||{};P.info[t.aid+':'+pd.i]=inf;store(ST+'p:'+U.id,JSON.stringify(P));cpost({action:'mark',id:U.id,t:U.t,aid:t.aid+':'+pd.i,status:'done',info:inf}).catch(()=>{})}}}return}
  view().innerHTML=`<div class="wrap st anim${tab==='profil'?' stprof':''}">${tab==='liga'?ligaHTML(P):tab==='profil'?profHTML(P):homeHTML(P)}</div>`+stNav(tab);
  if(tab==='profil')bindProf();
  giftCheck();
  document.querySelectorAll('[data-go]').forEach(c=>c.onclick=()=>{sfx('open');go(c.dataset.go)});
  const tl=$('#tgLink');if(tl)tl.onclick=tgLinkModal;
  document.querySelectorAll('[data-hv]').forEach(b=>b.onclick=()=>{if(b.classList.contains('on'))return;sfx('tap');store(ST+'hv:'+U.id,b.dataset.hv);drawMe()});
  if(tab==='home')globeInit();
  if(tab==='home'){tgNudge();bxAnim();const c=$('[data-count]'),k=ST+'xpseen:'+U.id,from=+store(k)||0,to=c?+c.dataset.count:0;
    if(c&&to>from&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const t0=performance.now(),f=n=>{const q=Math.min(1,(n-t0)/1100);c.textContent=Math.round(from+(to-from)*(1-Math.pow(1-q,3)));if(q<1)requestAnimationFrame(f)};requestAnimationFrame(f)}
    store(k,String(to))}
}
/* friendly, skippable Telegram reminder — at most once every 3 days */
function tgNudge(){const s=P&&P.student;if(!s||s.type==='guest'||!P.tgBot||s.tg||$('.tgnudge'))return;
  const k=ST+'tgn:'+U.id;if(Date.now()-(+store(k)||0)<3*864e5)return;
  clearTimeout(ui.tgn);ui.tgn=setTimeout(()=>{if(ui.stab!=='home'||$('.tgnudge')||!location.hash.replace(/^#\/?/,'').match(/^(me)?$/))return;
    const d=document.createElement('div');d.className='tgnudge';d.setAttribute('role','dialog');d.setAttribute('aria-label','Telegram’ni ulash');
    d.innerHTML=`<button class="x" aria-label="Yopish">×</button><div class="ic">${TGI}</div><div class="tx"><b>Telegram’ni ulab qo‘ying 👋</b><span>Parolni eslab yurish shart emas — keyingi safar bir bosishda kirasiz. Ustoz xabarlari ham shu yerga keladi.</span>
      <div class="bt"><button class="btn red" data-y>Ulash</button><button class="btn ghost" data-n>Keyinroq</button></div></div>`;
    document.body.appendChild(d);requestAnimationFrame(()=>d.classList.add('on'));
    const shut=()=>{store(k,String(Date.now()));d.classList.remove('on');setTimeout(()=>d.remove(),300)};
    d.querySelector('[data-n]').onclick=shut;d.querySelector('.x').onclick=shut;d.querySelector('[data-y]').onclick=()=>{shut();tgLinkModal()}},1500)}
addEventListener('hashchange',()=>{const n=$('.tgnudge');if(n)n.remove()});
function myRank(p){const rows=p.board||[];const me=rows.find(r=>r.me);if(!me)return null;const better=rows.filter(r=>r.t>me.t);return{me,n:rows.length,gap:better.length?Math.min(...better.map(r=>r.t))-me.t:0}}
const LVS=[[0,'🌱','Yangi boshlovchi'],[50,'📘','Izlanuvchi'],[150,'⚡','Faol o‘quvchi'],[350,'🔥','Bilimdon'],[700,'💎','Usta'],[1200,'👑','Chempion']];
function stLevel(x){let i=0;while(i<LVS.length-1&&x>=LVS[i+1][0])i++;const c=LVS[i],n=LVS[i+1];
  return{ic:c[1],n:c[2],next:n&&n[2],need:n?n[0]-x:0,pct:n?Math.round((x-c[0])/(n[0]-c[0])*100):100}}
function homeHTML(p){
  const s=p.student,rk=myRank(p),T=tracks(p),lv=stLevel(p.xp.T);
  const all=T.reduce((a,t)=>a+t.total,0),dn=T.reduce((a,t)=>a+t.done,0),pc=all?Math.round(dn/all*100):0;
  const nx=T.find(t=>t.done&&!t.finished)||T.find(t=>!t.finished);
  const nxHref=nx?(nx.booster?'#/me/b/'+((nx.cur==null?nx.done:nx.cur)+1):'#/me/a/'+encodeURIComponent(nx.aid)):'#/me/liga';
  const h=new Date().getHours(),hi=h<11?'Xayrli tong':h<17?'Salom':'Xayrli kech';
  return `
  <section class="sth">
    <div class="sth-top"><a class="sthav" href="#/me/profil" aria-label="Profil">${avHTML(p.av,s.name,lvIdx(p.xp.T),'md')}</a><div><small>${hi},</small><h1>${esc(s.name.split(' ')[0])}</h1>
      <div class="st-meta">${s.type==='guest'?'<span>Mehmon</span><span>vaqtinchalik kirish</span>':`<span>ID ${esc(s.id)}</span><span>${esc(s.group)}</span>`}${(()=>{const a=actOf(p);return `<a class="stkc ${a.cur?'on':''}" href="#/me/profil">🔥 ${a.cur} kun</a>`})()}</div></div>
      <div class="sth-ring" title="Umumiy progress">${bxRing(dn,all||1,'#fff')}<div><b>${pc}%</b><small>bajarildi</small></div></div></div>
    <div class="sth-stats">
      <a href="#/me/liga"><b>${rk?rk.me.r:'–'}<i>-o‘rin</i></b><span>${s.type==='guest'?'Mehmonlar':esc(s.group)}${rk?' · '+rk.n+' kishi':''}</span></a>
      <div><b data-count="${p.xp.T}">${p.xp.T}</b><span>XP jami</span></div>
      <div><b>${dn}<i>/${all}</i></b><span>bosqich</span></div></div>
    <div class="sth-lv"><div><span class="sth-lvb">${lv.ic} ${lv.n}</span><small>${lv.next?`Keyingi daraja “${lv.next}” — yana ${lv.need} XP`:'Eng yuqori daraja!'}</small></div>
      <div class="lvbar"><b style="width:${lv.pct}%"></b></div></div>
    <div class="sth-cta"><em>${!rk?'':rk.me.r===1?(p.xp.T?'🏆 Siz guruhda birinchisiz!':'⚡ Birinchi XP’ni hozir oling'):`🎯 Keyingi o‘ringa ${rk.gap} XP qoldi`}</em>
      ${nx?`<a class="btn big sth-go" href="${nxHref}">${nx.done?'Davom etish':'Boshlash'} <span>→</span><small>${esc(nx.title)}</small></a>`:''}</div>
  </section>
  ${s.type!=='guest'&&p.tgBot&&!s.tg?`<button class="tglink" id="tgLink">${TGI}<span><b>Telegram’ni ulang</b><small>Keyingi safar parolsiz, bir bosishda kirasiz</small></span><em>Ulash</em></button>`:''}
  ${!G3&&p.ai?`<a class="aicard" href="mashq.html#ai"><span class="aicon">${AI_SVG}</span><span class="aitx"><b>AI Writing yordamchi</b><small>Xat va esselaringizni AI tekshiradi: ball, daraja, har bir xato o‘zbekcha tushuntirish bilan</small></span><em>Ochish</em></a>
  <a class="aicard sp" href="mashq.html#speak"><span class="aicon">🎙️</span><span class="aitx"><b>AI Speaking yordamchi</b><small>Imtihondagidek gapiring: AI tinglaydi, transkript qiladi va 4 mezon bo‘yicha baholaydi</small></span><em>Ochish</em></a>`:''}
  ${homeView()==='list'?`<div class="vtogrow"><h2 class="sech">Barcha topshiriqlar</h2>${viewTog('list')}</div>`+listHTML(p,T):globeHTML(p,T)}`;
}
/* one assignment card (the same in the list and in the globe's panel) */
function tcardHTML(t,i){return `<button class="tcard ${t.finished?'fin':''}" data-go="#/me/a/${esc(t.aid)}">
      ${coverHTML(t.cover,i,`<span class="tnum">${t.done}<small>/${t.total}</small></span>${t.finished?'<span class="tbadge">🏆 Tugatildi</span>':t.done?'<span class="tbadge">Davom etmoqda</span>':'<span class="tbadge">Yangi</span>'}`)}
      <div class="tbody"><b>${esc(t.title)}</b>${t.sub?`<small>${esc(t.sub)}</small>`:''}
        <div class="track"><b style="width:${t.done/t.total*100}%"></b></div>
        <span class="tgo">${t.finished?'Sertifikatni ko‘rish':t.done?'Davom etish':'Boshlash'}</span></div>
    </button>`}
/* the classic view: every section one under another (when the student picks "Ro‘yxat") */
function listHTML(p,T){
  return `${SECS.map(([k,l])=>[k,l,T.filter(t=>secOf(t)===k)]).filter(g=>g[2].length).map(([k,l,ts])=>`<h2 class="sech">${l}</h2>
  <div class="tgrid">${ts.map(t=>tcardHTML(t,T.indexOf(t))).join('')}</div>`).join('')}`;
}

/* ================= KNOWLEDGE GLOBE (Multi-Level, 25.11.2026) =================
   Feedback: the long list of sections made students forget what was at the top. Now every kind of task is a place on
   a small planet: tap its pin (or its chip under the planet) and the planet turns, zooms in and that kind's tasks open
   below. The real continents (Natural Earth map) on one 2D canvas, no library. "Ro‘yxat" brings the old list back (remembered per student, on this device only). */
const GREG={mock:['🏁','#FF4D5A'],reading:['📖','#19B5BA'],listening:['🎧','#9B6BFF'],writing:['✍️','#2BC46A'],vocab:['🔤','#F2B000'],grammar:['🧩','#4C8DFF'],other:['⭐','#F0558A'],
  /* General English 3: one place per book unit */
  u1:['1️⃣','#F0558A'],u2:['2️⃣','#F2B000'],u3:['3️⃣','#9B6BFF'],u4:['4️⃣','#19B5BA'],u5:['5️⃣','#FF4D5A'],u6:['6️⃣','#FF8A3D'],u7:['7️⃣','#4C8DFF'],u8:['8️⃣','#00B3A4'],u9:['9️⃣','#C2410C'],rev:['🔁','#2BC46A']};
const homeView=()=>store(ST+'hv:'+U.id)==='list'?'list':'globe';
const viewTog=cur=>`<div class="vtog" role="group" aria-label="Ko‘rinish">${[['globe','🌍','Sayyora'],['list','☰','Ro‘yxat']].map(([k,e,l])=>`<button data-hv="${k}" class="${cur===k?'on':''}" aria-pressed="${cur===k}"><i aria-hidden="true">${e}</i><span>${l}</span></button>`).join('')}</div>`;
function globeRegions(p,T){
  const R=SECS.map(([k,l])=>({k,l,ts:T.filter(t=>secOf(t)===k)})).filter(r=>r.ts.length);
  R.forEach(r=>{r.e=GREG[r.k][0];r.c=GREG[r.k][1];r.d=r.ts.reduce((a,t)=>a+t.done,0);r.n=r.ts.reduce((a,t)=>a+t.total,0);r.open=r.ts.some(t=>!t.finished)});
  return R}
function globeHTML(p,T){
  const R=globeRegions(p,T);ui.greg=R;ui.gT=T;if(!R.length)return '';
  return `<section class="glb" aria-label="Bilim sayyorasi">
    <div class="glbh"><div><h2>🌍 Bilim sayyorasi</h2><small>Bo‘limni bosing: sayyora yaqinlashadi va topshiriqlar ochiladi</small></div>${viewTog('globe')}</div>
    <div class="glbc"><canvas id="glbCv" role="img" aria-label="Bo‘limlar sayyorasi: ${R.map(r=>esc(r.l)).join(', ')}"></canvas>
      <button class="glbback" id="glbBack" hidden>← Butun sayyora</button>
      <div class="glbz"><button data-gz="1" aria-label="Yaqinlashtirish">+</button><button data-gz="-1" aria-label="Uzoqlashtirish">−</button></div>
      <span class="glbhint" aria-hidden="true">👆 Har tomonga aylantiring, belgini bosing</span></div>
    <div class="glbchips">${R.map((r,i)=>`<button class="glbchip" data-gi="${i}" style="--gc:${r.c}" aria-pressed="false"><i aria-hidden="true">${r.e}</i>${esc(r.l)}<small>${r.d}/${r.n}</small></button>`).join('')}</div>
  </section><div id="glbPanel"></div>`}
function gpanelHTML(r,T){
  return `<div class="glbp" style="--gc:${r.c}"><div class="glbp-h"><span class="glbp-e" aria-hidden="true">${r.e}</span><div><h2>${esc(r.l)}</h2>
    <small>${r.ts.length} ta topshiriq · ${r.d}/${r.n} bosqich bajarildi</small></div><button class="glbp-x" data-gx aria-label="Yopish">×</button></div>
    <div class="tgrid">${r.ts.map(t=>tcardHTML(t,T.indexOf(t))).join('')}</div></div>`}
function bindCards(root){
  root.querySelectorAll('[data-go]').forEach(c=>c.onclick=()=>{sfx('open');go(c.dataset.go)})}
/* ===== Earth globe (26.11.2026): a green hologram of the real continents (Natural Earth 1:110m land): the land as a fine grid
   of light, glowing coasts, light orbits round it. One 2D canvas, no WebGL, no library.
   Spins freely in every direction (trackball + inertia), pinch / ctrl+wheel / +− zoom. A tapped section flies to the front
   with north up; left alone, the globe settles upright and turns slowly on its own axis. ===== */
const GEO_LAND='nlB_xBFJFJpBCrBAXGACLEuBAqBBQIKI.vjD1xBlBBZGLIBALGMImBDUFOF.nc3wBaJILCHCJfFfFlBDpBDvBAZIEIqBGSGMIKIMGMKKAeE.3rC9tBaDYELFRFbCTGEI.vuC9tBgBHLCZCbEOG.79B9sBWDWCMJPCXBXCbBTEJIMEaD.5qBrsBEHDHFHXBVDZAKIXBVDPGAIWIOCWAGKCIAQKKSCMHEFIJIH.vwD90BCAQMkBHECECICGCCAEACAcHaIEA6BEUDKBeH4BDuBFsCF6BG2CDwBF0BG4BGEItCChCEPI1BEEKIIGGDKfEPIdGwBBuBEeFiBGiBGQIHIZEbGpBCjBClBCNIZGPIFWKBSFiBCgBCQHgBCaEaGWGeCAIHIGGaEMFeEYEcAaCcGWEYEQBOAcCcDaAcEaBeBcAcAeAcAUGYEaDYCWIMFIHMFUGYHcBWFeCYEeBcBcDKINIJGXCLIDGHQQDaAaAYBUFIHcAaCaEaCUDaCSOQHWDaCQHaAYBYFQIIIUHcCUDOHaCUEWGYCcEaCSEMGGKDIFIFGFIFIAICIIGIKEGDKBIIIMGMIOGQGIIMGMGUAMGOEQCOGMGQCMDHHTFHDPEPBNDNFJFBHAHKFNDRBLFLFLJDHIHKFQDQFIHEHGHKFGHCRGHCHGHBJLHLFZDHFNHdFZDXDbDPHfBjBCfBfAGHeDWFMFVFhBCbFBHAHYFEHYHsBBkBFcFkBFyBDwBDiBFmBHUHKHYGgBGkBGqBGiBGyBAyBBoBFMIcG0BCmBEmBEqBCsBEeGNGHIAGlBApBDlBAFICQKEcEiBEYGYGSIcEaCOCgBCcCaEYEWGcGSGSGGIVEIIOIUCWGUGQIKKOEYAKHYAAIKIWBGHYBaEYCWAKHWGUEWCWCWGWCQGMGQDUCQJKFYEIIUEaAIHQIWCYAWAWBWBIFOFWEWAYAWAUEWCQGUCUCQGKMMGUDIFSDUAOFOFWGGISEWGSCYEQEQGQESBSGOGSASECISGQCUESCSBUBQDCJQFMFYBOFQFUAQESISDUBSDUAUAQVADBJTDPHCHYADHJFJJQFYBWEMIGIMGMGEGMKMCWCUCUCKIGIOIUEQEMIMCOEUBSCUCWAOEKOIFIJSBSBUCUBSAOCQBQDSEWASCUBOGKGOGYOOBOFOFaLUBSAWEUCSGMGYAOEQDKFOFWAODYFYBWCQGMGSCSBWBSCSASBSBSEWEUAWAUCSCEKCIMFEHGHIHSDWCaASCaAUAaAWBOFDHMFWDWFaDcBUDWAOGSDOFSFYBYBKHWDQHWBWAWBYAYAWDWDUDOFBHJFJJFFJJZBLHZDJHLFPHHHDFBJAHMHEFIHmBBIJjBBdDlBBRJDJHHJFaHKHSHYFcFeFuBFKJ6BDEBOF4BEuBF.rqBzhBaNcDHJTAJGFHPFVCPGTCZMTKbYSDcNaHKKGOUIOBGJ.xkB9fQHFHbFHIRJJKYKQD.-rBhffBAMEIAEOFSDCD.86CvZUFKCQEMBCXHFBPFGNNDANCLQBOLQAK.ksDxZEHQIEHAJFHNPJHIJPAPFFNLTPJJDRALGVCDGKQaUMEQGQMMKKOIGCKOK.ktDzWOTCOIFEPQFMBMIKBDRFLPCFFCJBDHJJNPHBGHCKQFMVICIOGCQAMHOAEJINSJOIAMJOF.uoD7NHDJGNINMLODGKAKHKFGFQL.wvD5KGFBLNBJCBKIGIB.vwDrK0gHDNDBIKEGAzgHGECBJ.8oDpKFBFIAG.uoDpJEPFCDBBGBQ.qfvICXGHBJDFFMDFEPBHFDBRHVJbLlBHbHVPFRHLGPGDKBSHQAOCQKCAIKOCOFIDOASGKCOKAMEIEIAMMQMGKBIIBKOCMGKGJGH.45CzIGNOGGHKHBHERCJGBGRBJGNWJOJMHBDMNITIEIJEEEVOLKHQPEPCJBNKPBRDJDRAJDNJTNHHPFJFRHJDNDNCFLHVARHJHLHPILECKJDRNRGJCLCTGLMDQDKJITCGKDOJNRDMMCMIKBOPRLFHPPIAMLOJIEEZMNATKjBBZFVHTCTJRFDJFHRALBRENBNBLJFAJDJHNCNATMLEAMKCEEAICOBMJUDMAKHOAGHIDQJQDIKHHSKFGHAKJQBGDGCMEECKBMIOCNIOSGIIQIKCEBQGMCEGGAKAWGKKGKKKCIAKOSIRKEHKGKKDCOKKGIKEAGIBAEKCKEOJMLMAMBDMKQIEBGIMMGKBSEAKPGMEMFMHQDGCMFMEIAECKJFJHHFACHFJHJCFQLQFKFOLGAKFEFSFOGEMEICMGQBIAGBMEQCEBGEKEMAGIGGJCLEBCHGJCL.qlDxGGFNAHMMD.urCrGHBZOSEKFIF.ykDlGHALCFECIODGD.ilD_FDDNSDMGAIP.4tCpGPFBECGIMUICEQGOAICGBFFVHPF.2pChFIFMCEHVDNBLAIKKC.6sChFBLdDbCAIQEMFOA.-jDlFADPIJGHIECIFQH.uiDxEDBHEHIAEMH.8jCnEmBBGIkBHINeDYLVHVKRBVCREXINCHDjBIDKRAOUYBQFIB.m0C7DJNBQEGEIEF.uhDnEFBHIJMDQECCFGFILKF.g_CtDJBDDJFLDJAPGLGCGSDKCEKCACJMAGIKGBMMCEDAL.wvClCFFNEDIUC.yxC9BGPPKPALANAEMaA.2_C5CFFDMDIHGLKNGEEMFGDIDIJIF.6zCXGfWLQWWMSASHOFWDiBNmBLOJKJELgBLGJRBENSLMVMAAHODFDWHBFNBDGRCTEPMJMLQZKPFLFCPPFJCVCRQTEDFZAIQOGFWJQlBSPAdUFJHBDIAIPKWGOABGdAHMREHKcEKGgBH.ouCcPTNDTEfARDDNSRMIkBIAJJEHLRHUZDFSXALLFHGKQTHDGCINMCUNFCXAbLDHGGSDUHAFOIOCOKgBEISOQFYBYAUO.uwCWBPJCBNIJFBHMFaEQGICLMB.kiC1DVAPSZQHMPQJOPcPSFQHQROJQPMTWBKMBgBDSRONMHSVWAQNMPOJHPMHIACNIJOBKNDX.2pCkBWRXBFNARRNBTHdBGVHHMNCJGXHHKNAPCBaJGJQBSCSMOOFQEEQIEYEOQKMIISKOOKQIAKJCHMFSFBHNAEJNHLROR.gvCoFCLALFRHUHJGPFHXMFOGKLIFHJCNLDGIQMGMIGJQGEKOABQQJCJ.4yB8DRDHQDcIgBOJKNKVDT.hmBqGRBDCGGAIMCEA.wtCuGHHFLFFLOEGEGCMMADLQS.iqC6FZRKOOMMOKUEPNL.msCuHMFMAAHJJLFAKAK.uuC0HGXPGAFGLJFAOFCDMMBAILQSB.-rCmIDRJKJQSB.6rCyLMFGGCFBHGNDPLHDPEPMBICaJBLGDBJPKHMDHNMRDJGCIGEFGBHJMDIAUIHCgBGS._oBsLDDPALBAKCCQAKB.hwBmLFDLEJGCGIAEAOBKDEF.rtBuMSDCEQAMFEAEFMABFKAKHHHJEHAHABDHADEFBHNFEAENEHBNCHDLGCIUDOBIGJIAILCEG.-kC2LPJPGBSKIWGMAEHHH.lhD-LDDDEAEDICCCEAEACCBIBEBCBGHHF.xhD8MFADEBCCCGBGB._hDoNABJAAC.xiDqNBAFADEACGCCA.xjD4NDBFECACCEA.5xBoOIHUCGDSLMJGAMDBFQAOHBDNDLANCdBOKHGLAHGDMLAREFEZEHEIETCNJHADFHBJCMGEIIEKEQCECSBQA.twB8OFBDMHGEMGAIR.4rCoOJPJQBQMSQQKFDL.zwB0QVDBIKCOB.jwB0QDNDCCKJIAC.k0CqVEFLLHGJDFLLGAKKMMDIK.0VqWNJCBABTHJCDIIACACGQA.6OqWKFQAQABDMCBFdBAEXE.2J8XFPCFDJPIJCbKEKWBWC.4F4ZMNBZJAHFHGAYDMKB.k4CmXHPEJJNZHjBBbVNGAQjBDVJXAUPNfLJJIESLGHOUGKMUMOMoBGWDUkBOJeUKIOYDYIMWEKbAPRT.gGsaHPHEFOEGOI.-5C0bODOIEVbFRTfOJVVADUKOWCGcGQWV.5nBidQBSAJHHAXIFGIG.zmB2eJAZGRKGCaFWH.ltCqeJBhBIFIPGDGVEFKAGWDMDSBIHKHUH.hjB2fNROGMDFFSFIGUHFNOECJINJPHBNEEQDEXRLAOKTETAnBABGMIHEQMUgBOMQGKADF.9yC4hBUCHVSPHALIHKJGBKAG.45C2fWhBdGLbSVANPMLNDQCUBWEOCcLSCcSKHIKEENITBR.nE2gBjBLbCQWJUcQOISCULJNEN.-H4iBLPVMBIeG.z_C2jBTHJGDKSGMEMBKF.7B0kBVTUCWADPRRUBUZOBMXGHYDBLLFIJRJZAhBFJELJRCNFLEeUSEfEFIWGLKEOeBEMNMXEFGIIFGLJAULKIUQQQA.vnDulBLBLCNGUEQB.xxB8mBHLHCFGCCIGIA.lzBmnBXJNADGQIaA.prD8nBMDMCQFUBBBNDPEHERBDC.n1BipBEJKEMFWFYFAJQCOHRFdGLITJbJHKZBQKEQGS.hJypBDNWNZN5BNRDZC3BIUIrBKkBEAGpBEMOgBCeNeMaFgBK.tvB-pBVADKIKSEQFAHBD.vwDkrByBP0BTBLOFFQ2BDoBRTJfBBRHDRAPGZGDKTCXBJGEIXDKJLHghHAZJZCSJMPKFCHFFjBE3BNRBfPbLHHbOzBPJIRJbEFNXTCHWDBbTBHPIHhBLHVdDFVbRHOHeLsBKcSMAIgBGiBYkBUkBQQeXBLRzBVPazBHxBfQNrBDdBAOdEZJ7BChCF_BlBtCvBgBBKLUDMKWBcVCRPTBXHfdbHNZXbVLLbLLALKbNBHHCHHFFANJDDDHFLDJDAJBBIBMJQXGLAXHJRDPHRBBKEQJUQENQJEBBFBBEDAFEGIEEBCGMBELCHEbFPHTFKKDIQMLKPFXNLLTBJJMLQDAJQDWOSHOACLbDJLRJJNUJITMROPAPLDELMFDPDPLBNTPbRXbRbPVBLJHGLHbJTDHVJAFOGIbGJBZRPRDNOVUZSLMPIlBBhBPNXLPRXRHMGOPMPCHMJURIRAEQRABVJdFPAPOAIRERKJMDKJGBMLILANBJCFCLIFGRAFNBRQXQBKLMBSHKCODKHGDKJMJKDLDKEOGSBQGOHMCWHKFYDaHQNJVNLCLEGaDSPYEGLENQFKBKDKHMRACHFLJEBBFCHCBHNAXDAPJJbNXXNLTNAHJFRFJBFPEZCPHRAhBLBHPGFRFHLHFRSJcHUFKJSFaDMRcHmBFaAYDUbLNCZYIIFGVSPEFQNOlBDfAbBlBGVEVCHaJCPBTJXGTQTGLSPaJBNGFHLCEJBDGNIRKDEHOHAHBHCFGFEFCDBOGKGCGFALDLEHECAFQEQAMBOOOMOOGGCBBHBDCPINMFODMBKLEFIDADHLBFHFHNJCDFBJCLBDJALFBJDDLAHFAHJFLCLFJANFDJAFTHfJRNJBFCJHNDPBFADFFABFJAFBNAFMCMDGDOFIECBICEAIBKHGAIJGLSFQNOHCNUBOCMLWJIJEFMAEFKFEFQNQJOJAEKAIEIBCFHDPDJFDFIJINeBBIVMTQfIJGLSVDBANYREDGTDDCTIXIDKHMXGRKJcRKLMLGFKFEFAHLFIDIDEHIJKAUGUCSGKCIEKAIAIEMCIGIAAFBJALDFDVJVLZRdRVVZTRdRTPVXDJDFNHFHFBDNFHDLHHJXCLMFCFFLCFBJGLKTGDEJBTEPAfEJFNHNLLTHVJVVHBNPHDBNKPEJAFEABTBHEDBHJHPFXLHFCHEBBJDPBPFJNJDBHJFJJNXVNLNHVHJBBDLCJDVELBHAVHPBLHJAHGFCJIABDECMHOGEAOLUJQPaNQHODUFOFeAYBMHIJQLYDOPSBQBMESGSCKGSEIMMGKCOAMFGFMDMAEGIFUDOJMCEBGFQPUTUNSLUAGEGGQEODEGWEQHMJEDKDCAGTHHCHFPCJMHONONARAPDPDfLLFRFRGHANELAXDNFTHDCFATIRQRKLOFCNIJKDIBOJMHIDCFEBKBEFCLKHADGAEFEBEBQCIHQJGIEKOEKBMGKESDUBKCKDKLICIAKIGGKAGGOMOGCGMAKIOMGOUKISCQOKGQQDaIQCMMMUKQIOUGOOAMJUCUDIAUKWEMIUGiBEgBCKDUIUAIDOAWKODAJQICDJJAJGDBRLJCJMAEJIDYFICQDaHKRSDcHWJKEKKFQGIQKMCcDGHIAGDUBGFaAUFSFKBQGIGSCODGJEIQFQAKEGGBCGKEOCGIQKOBQEIFKIILBRENLdBPKVCDHNDTMVALUNKKQLKWSeCIOmBBYMYGiBAiBNcHYESBYKCKDMLILCFGZSXIPKOEQQJIcIAGRDPBLFTBPFALKFUCDHVDZJLEEITGCEUIFEfEAITBFLPNAFJDFCDXLHFNGLCHSFDDXBHFPJHICENCJAXDOLJBLAJKDDGLKJHDKJKFAJREGJLBIRNAPIHQDOHKJKAGDCAELIBICOCGBEDCFGJERGLIRGPOECJIAILCFHFGAIECPCPFCJBFGJSJKPWPQAGFFDSFOFSJCDDHLKPCHLOHBJJBJPHBAGEMEEHKFKHEFILEJINCPIRONKFUJCPIJDLHHBRLlBGdFBLALRNZDBFLLHPILLHDNNDNNZATALHHHJCFIFKTEHFJEJBEQBMJCDGCOIIAIEMAIDGAIAOHIcOYBcAWDQCgBBKMEoBTWPKdIBOaEiBFFYSJuBQGQSEQEKGSecIQAEEQAEDOKDIBMHKAUEGEGSCIEQGBJDFCFKBDHFCPNGJAHUDAHWEKGWHKFOGgBIYIUDCFUAEKcGDQAQKMSIQPQAEQCMFBNGBMaGaCUDWCWKTKjBBjBFfFLMTGEUHSIMSMuBWOEBIbKhBFTNELfPnBRNbONUJRVVFHhBJRXCLPXAFSPWPeLMnBXZDbKHWFuBSM2BSmBUmBcwBmBgBQ4BYsBKgBBeQmBAkBE-BNZFWLUGiBL2BDsCXQHANVJfF5CQNDgBNCdaFQDCILKOGwBLQGLOuBUSBUFKOPMKMNM4BHKJXBALOFgBEEMqBKmCSQBTLYBOGmBCeIWLYMVMMI6BHcFoCVOKTKBGXCIILQAGkBSOSOE2BDELTPOFGNDbWLJNlBbWBIGWGGKSKLKIOVCDKQUZQkBODOKCKLHTWBJOiBIqBAkBLRSBUkBGwBBqBCPMYMWAoBK0BEGE2BCQDsBKmBAEKUIwBIiBFbFuBBEJUE6BAsBJQHDJVFzBJPFYDeDSEKNKGgBEgCDEJ0CBCOqBBgBAgBLKLLHYPgBHUUgBHiBGmBHOGiBBPScI0FLSL0BPwCEoBBQHBPYFcEkBCkBDmBCkBRYGPOKI-BFqBC6BJ.2e6ZKNKBGDPBDPDHFDAJGNSDOJeDeGCEDOEWPGGONAESUFQINMFKPDBPFOBEGIDIXGHSLGAGUBAOSEQBESDOTBPEXHRDJLRDTTSRBNWX.37BmrBNFZGPBbISGOIUDMDGD.vwD2sBghHNVADG.vwD2sBCCSAcFBDTDZB.x4BurBATaQYNFNUNUOOSCWcBeBaJCJPLOJBJlBNbBVGFJRRFHXNbBPHBLVDZPTVHPBXeBITKNcEmBHUHOJYFWHgBBWBBPGTOVeTQGKWJeNMgBIWOMOBONSXOYWJSFeOGiBFUBSESFYLGHkBAARGXSDOLeMUWMIQRaXWXHNaJSLgBFOFIPODIFCXNFNHhBFXRhBBrBEdATBPNZHdbVRQEgBaqBQeCSJRLGVGPaJiBEUWANOHXLtBLRHXPNCBSkBQfAVDCFTJVFTFLNBBALGJIABGGDBFLBJAPDHALBPFeEGDbFNAAEFFGBDNNPBGDAFGEJEDAHFHJPBCGMJIDQBHELNCOFARGBCFETNPTFNLJAJHBFVNLJHLDNENGPKNAJIVANAHFLFBJCBIHGJQJQDIEODKPQHETJDCJKLEVBRCPBHBEFAHEDDBHCHDNANMRBNELBRDRPTHJJFHANCJEFHRDNBbBJEJGJEPONELIJWDIJSGOCQEMEMIGMAQEGOGWEQAMAGDAJLJDNEBDJDNFEDAABEBADDJCBBHCBDJDDBBDFGDCEGDCAEEGACBCAKAKAGCCCGAGBEAECKBCBGDGDIBGFBBBDCHDFBHBJCDAJBBBHAFDDCFCDGJIHKHGHADIACAGDKCIEMEGGMABBMBIDIFGDMBOOICAIEQMKMACEQBQKIGIIIAGFDFBFJBGHALJJIPIAGQHGAQYIBIIIGNOBOJAFSBWCKHQBMGAEYCYAPFGJQAQJCPKAIDOHMNAJIAMJIFYDCEQAUDIDODWPCHIAELMhBKDCNPPGFkBBATQMYFiBNKJDLYGmBJeAePaVOFSAIHGXELHhBJLbbNXNPFBFNClBFdBNFHDZTZBTRJDLVAdHPHVFVPRTBNCLDTDJNJVjBRPNHHTNLHLVLPEJBRKNBLMBJaRDNOHBJRZdJnBDVCELDPEJLFVDRIHFCTOFKIGLRFPLBTFJRAPLFNUNUDHRXLLXRHHHGVMLHCRAHDRHDRHBXIVOXKHOGMJMBiBIUWQdGSQGiBYHKqBNGFZLEGcGmBKMFUBWICMgBOgBKeFeGQBYMaEmBGqBGsBBgBDeTKBIlBUjBWPOHQCGPaTkBRoBHKHONOPIIIJUGOQMKODKHJLKEEBSGEEMIOBIMEMIBGICBKGGKCIMIKHGEMDSEEDSHKFGDMEEDCDGJGJBDFHFDABDKLFBBBJBDMBDFCDIHCFCHAADDCJEDGCCAGFEHEFCBGFECFDDDEHCBEAGCIDCEEHGHIDGJIJICEEDCCDGFCBFLCFCJEJAFEJELAJEJIXWJGPGLBPFJBNENERKPCVKRIDGLCTGHIVMJMDKGCBGEGAGFKBIFKRUTOJORIBECMJGLKDOLALMHKBGJOHQCIPIFBLGBHCJCNIHONEFCAEHCAELGFGFMJGTGHGJAJKAIJIHADJHBAFMNMNKJEAQBKJGNKBDDGNELMCCIBIIAKNOLGHMHMHQHSDKLMJCBGLCFETCDEBMTUPcAEJGNSDQJKEQASFQISEkBDcFQFKCEeHKRGGDQFQDAlBUNIjBILSEMZKDQXOAKLIRGDSZQLSRCfAXGpBUREjBIbBlBKXIVDENLBVDRFVDDKKUWGFGZLNLbNOJRPVHTFFHdJFJXHNARDTHRFhBFBEWISGWMYCKIcMEEQICOMMXFFELHLKFFHKTHLABMEGLIZDRKLEBMNIIMQKGKQCOBQIQAOGDIJEOILAVDFFNGdDbGHIZMcIsBKQABJqBAPMXINKTIbIMKkBAYKGKUIUCmBKSBeMeFQHIEiBBBDgBDUCqBFmBBQBaEeFWDmBDgBJUBSIYGeBeIgBGOHOEGKOBgBRcOCPYEIGYBgBHuBHcDUCaJbJkBD2BCSEULWKTIMIYASCQDULWCiBJgBEeADMSEgBHARMQQAKUVMXICWYOaBUJcVRJ.rnC2tBJHuBGaJYKSHQRKINUSCUBWHMTGNiBJkBJBHfBMHFFjBCjBGVBlBF7BDZBLKZGRBXQMCgBCcAaElBErBBbAJIuBIfAhBGQOOI2BM.phC8tBRLdOGCaA.1vB2tBAFTCVAVDFCVKCIICuBB.j2B4tBQNSQ0BKiBVDLoBGUIsBLcHCJmBGUNwBHSHSRjBJuBLgBFeReAFNhBXXIfUZBBLULcJIDMTFNZExBQcPWLCH1BIpBMXKGGdKbKAF5BDRIOOmBAoBEFGIKYUDIHIdKpBGOEVORAPIJFjBDnCGrBGfCPIUIbAFUQSUI0BG.3-BkuBYDkBEGFTJgBHDRhBHRCNGxBQAGqBBVO.45C4tBdApBCBCSIaCcH.n6BwtBVPVCLQAKKKUEqBAmBDdR.prC0sBzBJJItBMGGQQSOTMkCCcDyBAUFWHZFvBNZN.m-C-uBVHfClBIGGkBD.v6B8uBLHbCXEKKcESF.26CovBPPpCAfDnBOKMaE2BA.x9B-vBQHALJNfBVEAKfABOWAeGcA.zjC0vBIHSEUAEJLJjCBxBJdADGqBK5CDbEcUSG4BHkBLiBAbSSIUB.-jBmsBLB_BEFIjBGBKUEBMoBQREwBQFKuBKiCOiCCiBIoBCOHNFnCJ7BH9BTdTfRER.l7BmwBWFoBASFFHYFMDcAcBgBEoBCiBBUHGHNDbFZE5BDnBAhBCzBGHMBKTIpBCVIII.zoCwwBBNPHRAlBHfDbEiBQqBMeA.z6BuwBJAlBCDEoBAOD.7kCywBlBFbGQIcCcD.uP2wBrBJjBGOELIqBEIH.xkCkxBXDfAAEUGKB.77B6wBdFPGJIAIaBKAYH.x-B-wBIHfCfGtBCUGXEBIoBB2BH.2hC-wBxDHmBaQCOA0BL.uL6xBgCNxBHJPRDJPXApBMSGdGnBSPQ4BGKFcAIGeC.8PoyBoBFdL5BB5BEDEbCVI-BGcDUG.-fqyBZBRBBBXDVEMItBAoBEeAEFMGSCeD.u-BqxBpBB3BEhBIPOZE0BOqBGoBLuBR.r2B6xBYHbFjBNjBBpBCVKCGQGlBAVGLKOIOGUCHEuBCaLiBDgBD.5qB-zB2BBqBBkBFADvBJxBDRDsBAtBLhBFhBPnBDND7BBcBNDQJRFfFJHbFEDiBAAD1BLzBG5BDdClBCBKkBEJOOC0BJZOhBEQIkBEGGbIHM2BBQBgBItBClCBjBIPIXGDGeEYAmBEeIYBWFQMaCkBC8BCMB6BCqBA.9Qm0B-DPlBHrCArDBKDmCC-BFmBGQHVJ0BGgDI8BDMHxCNJF_BBuBBXNPLAXYLdBhBFmBJERVAaRrBBYHHFbDbAaNAHnBIJFcDaLGPhBDPIXKGLXL2BAcB1BP1BP7BHVATHbTrBNLBbDbDRNANJLfPIPJPJTbBdSnBARKNUhBYJODSbSIONIUYeGIIEQVFLDRBXGBOIKUAoBDhBMRGTBPGWSLIPOXUZIAI1BMpBC1BBvBAXGhBM0BGoBCzCEtBICIsCKqCKII1BGSIkCOeCHKuBE-BE-BAWF0BKwBFcBqBFvBKCIkCMmCAaGmCC';   /* land outlines: Natural Earth 1:110m (public domain) via world-atlas@2.0.2; 0.1° steps, delta-coded */
const GEO={};   /* decoded once per page: coastlines, the land mask and the dot grid */
function geoData(){
  if(GEO.coast)return GEO;
  const rad=Math.PI/180,A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',T=new Uint8Array(128);
  for(let i=0;i<64;i++)T[A.charCodeAt(i)]=i;
  const rings=GEO_LAND.split('.').map(s=>{let i=0,x=0,y=0;const r=[];
    const rd=()=>{let v=0,sh=0,c;do{c=T[s.charCodeAt(i++)];v|=(c&31)<<sh;sh+=5}while(c&32);return v&1?-((v+1)>>1):v>>1};
    while(i<s.length){x+=rd();y+=rd();r.push(x/10,y/10)}return r});
  const V=(lo,la)=>[Math.cos(la*rad)*Math.sin(lo*rad),Math.sin(la*rad),Math.cos(la*rad)*Math.cos(lo*rad)];
  /* coastlines as one flat list of unit vectors; b[k]=1 where a new line starts */
  const p=[],b=[];
  for(const r of rings){const n=r.length/2;let on=false;
    for(let k=1;k<=n;k++){const i=2*(k-1),j=2*(k%n),a0=r[i],a1=r[i+1],c0=r[j],c1=r[j+1];
      if(Math.abs(a0)>179.95&&Math.abs(c0)>179.95){on=false;continue}   /* the map is cut along 180° (Wrangel Island): not a coast */
      if(!on){p.push(...V(a0,a1));b.push(1);on=true}p.push(...V(c0,c1));b.push(0)}}
  GEO.coast={p:new Float32Array(p),b:new Uint8Array(b)};
  /* land mask (equirectangular, 0.25°): rings unwrapped across 180°, Antarctica closed round the pole, the Caspian left as water */
  const mw=1440,mh=720,mc=document.createElement('canvas');mc.width=mw;mc.height=mh;const mx=mc.getContext('2d');
  mx.beginPath();
  for(const r of rings){const n=r.length/2,L=[r[0]];let sl=r[1];
    for(let k=1;k<n;k++){let lo=r[2*k];const p=L[k-1];while(lo-p>180)lo-=360;while(lo-p<-180)lo+=360;L.push(lo);sl+=r[2*k+1]}
    let d=r[0]-L[n-1];while(d>180)d-=360;while(d<-180)d+=360;const sw=L[n-1]+d-L[0],pole=sl<0?-90:90;
    for(const o of[-360,0,360]){const X=lo=>(lo+o+180)/360*mw,Y=la=>(90-la)/180*mh;
      mx.moveTo(X(L[0]),Y(r[1]));for(let k=1;k<n;k++)mx.lineTo(X(L[k]),Y(r[2*k+1]));
      if(Math.abs(sw)>180){mx.lineTo(X(L[0]+sw),Y(r[1]));mx.lineTo(X(L[0]+sw),Y(pole));mx.lineTo(X(L[0]),Y(pole))}
      mx.closePath()}}
  mx.fillStyle='#fff';mx.fill('evenodd');
  const im=mx.getImageData(0,0,mw,mh).data,mask=new Uint8Array(mw*mh);for(let i=0;i<mask.length;i++)mask[i]=im[4*i+3]>127?1:0;
  GEO.land=(lo,la)=>mask[Math.min(mh-1,Math.max(0,Math.floor((90-la)/180*mh)))*mw+((Math.floor((lo+180)/360*mw)%mw+mw)%mw)];
  GEO.dc={};
  return GEO}
function geoDots(n){   /* an even grid of dots over the land (Fibonacci sphere), as unit vectors */
  const G=geoData();if(G.dc[n])return G.dc[n];
  const o=[],ga=Math.PI*(3-Math.sqrt(5)),dg=180/Math.PI;
  for(let i=0;i<n;i++){const y=1-2*(i+.5)/n,r=Math.sqrt(1-y*y),t=ga*i,x=Math.cos(t)*r,z=Math.sin(t)*r;
    if(G.land(Math.atan2(x,z)*dg,Math.asin(y)*dg))o.push(x,y,z)}
  return G.dc[n]=new Float32Array(o)}
function globeInit(){
  const cv=$('#glbCv'),R=ui.greg||[],T=ui.gT||[];if(!cv||!R.length)return;
  const ctx=cv.getContext('2d');if(!ctx)return;
  const box=cv.parentNode,panel=$('#glbPanel'),back=$('#glbBack'),RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rad=Math.PI/180,TAU=Math.PI*2;
  const TAN=.5,DH=3.6,DSEL=2.45,DMIN=2.05,DMAX=5,GR=1.25,HM=1.13,AUTO=.0001;
  /* quaternion helpers: the globe's turn is one quaternion, so it can spin in any direction without locking */
  const qm=(a,b)=>[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
  const qa=(x,y,z,g)=>{const s=Math.sin(g/2);return[Math.cos(g/2),x*s,y*s,z*s]};
  const qn=q=>{const l=Math.hypot(q[0],q[1],q[2],q[3])||1;return[q[0]/l,q[1]/l,q[2]/l,q[3]/l]};
  const qs=(a,b,t)=>{let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];if(d<0){b=b.map(v=>-v);d=-d}
    if(d>.9995)return qn(a.map((v,i)=>v+(b[i]-v)*t));const th=Math.acos(d),s=Math.sin(th),wa=Math.sin((1-t)*th)/s,wb=Math.sin(t*th)/s;return a.map((v,i)=>v*wa+b[i]*wb)};
  const qmat=q=>{const[w,x,y,z]=q;return[1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)]};
  const ease=k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
  const G=geoData();
  /* the sections stand on real land, spread round the world (Tashkent first) */
  const ANC=[[69.3,41.3],[-98,39],[134,-24],[22,2],[-60,-11],[9,49],[113,33],[78,22]];
  const C=R.map((r,i)=>{const a=ANC[i%ANC.length],lo=a[0]*rad,la=a[1]*rad;return{lo,la,v:[Math.cos(la)*Math.sin(lo),Math.sin(la),Math.cos(la)*Math.cos(lo)]}});
  let sd=7;const rnd=()=>(sd=(sd*16807)%2147483647)/2147483647;
  const STARS=Array.from({length:300},()=>{const z=rnd()*2-1,t=rnd()*TAU,r=Math.sqrt(1-z*z);return[r*Math.cos(t),z,r*Math.sin(t),rnd()*TAU,.6+rnd()*.9]});
  const NDOT=22000;   /* dots over the whole sphere; the land keeps about 29% of them */
  const S={q:qm(qa(1,0,0,.38),qa(0,1,0,-55*rad)),w:[0,0,0],sp:0,D:DH,Dt:DH,sel:-1,tw:null,drag:null,pinch:null,hover:false,vis:true,
    hit:[],time:0,pf:[],warm:20,lq:0,rel:0};
  const DPRQ=[2,1.5,1];
  let W=0,H=0,dpr=1,last=performance.now(),M=qmat(S.q);
  const size=()=>{const b=box.getBoundingClientRect(),w=Math.round(b.width),h=Math.round(b.height),d=Math.min(DPRQ[S.lq],devicePixelRatio||1);
    if(w===W&&h===H&&d===dpr)return;W=w;H=h;dpr=d;cv.width=Math.max(1,Math.round(W*dpr));cv.height=Math.max(1,Math.round(H*dpr));
    if(W&&H)draw(last)};   /* redraw at once: a resized canvas is blank until drawn */
  const ro=window.ResizeObserver?new ResizeObserver(size):null;if(ro)ro.observe(box);
  const io=window.IntersectionObserver?new IntersectionObserver(es=>{S.vis=es[es.length-1].isIntersecting;S.pf=[];S.warm=10}):null;if(io)io.observe(box);
  const rv=v=>[M[0]*v[0]+M[1]*v[1]+M[2]*v[2],M[3]*v[0]+M[4]*v[1]+M[5]*v[2],M[6]*v[0]+M[7]*v[1]+M[8]*v[2]];
  const pill=(x,y,w,h,r)=>{ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()};
  const BUF={};
  function draw(t){
    if(!W||!H)return;
    const cx=W/2,cy=H/2,F=Math.min(W,H)/2/TAN,D=S.D,Rs=F*GR/Math.sqrt(Math.max(.05,D*D-GR*GR)),zc=GR*GR/D,k0=F/DH;
    const zp=S.sel>=0?Math.max(0,Math.min(1,(DH-D)/(DH-DSEL))):0,lo=S.lq>=2,sc=Math.sqrt(Rs/(F*GR/Math.sqrt(DH*DH-GR*GR)));
    const m=M.map(v=>v*GR),pj=q=>{const k=F/Math.max(.2,D-q[2]);return[cx+q[0]*k,cy-q[1]*k,k]};
    const proj=(src,key)=>{let b=BUF[key];if(!b||b.length!==src.length)b=BUF[key]=new Float32Array(src.length);
      for(let i=0,n=src.length;i<n;i+=3){const x=src[i],y=src[i+1],z=src[i+2],X=m[0]*x+m[1]*y+m[2]*z,Y=m[3]*x+m[4]*y+m[5]*z,Z=m[6]*x+m[7]*y+m[8]*z,k=F/Math.max(.2,D-Z);
        b[i]=cx+X*k;b[i+1]=cy-Y*k;b[i+2]=Z}return b};
    const path=(L,b,front)=>{ctx.beginPath();let on=false;const f=L.b;
      for(let k=1,n=f.length;k<n;k++){if(f[k]){on=false;continue}const i=3*k-3,j=3*k,z=(b[i+2]+b[j+2])/2;
        if(front?z>zc:z<=zc){if(!on){ctx.moveTo(b[i],b[i+1]);on=true}ctx.lineTo(b[j],b[j+1])}else on=false}};
    const dots=(b,front,sz,col,a0,a1)=>{const nb=front?4:1,span=GR-zc,P=[];for(let q=0;q<nb;q++)P.push(new Path2D());
      for(let i=0,n=b.length;i<n;i+=3){const z=b[i+2];if(front?z<=zc:z>zc)continue;
        const q=front?Math.min(nb-1,((z-zc)/span*nb)|0):0,s=sz*(front?.55+.45*(q+.5)/nb:.8);P[q].rect(b[i]-s/2,b[i+1]-s/2,s,s)}
      ctx.fillStyle=col;for(let q=0;q<nb;q++){ctx.globalAlpha=a0+(a1-a0)*(q+.5)/nb;ctx.fill(P[q])}ctx.globalAlpha=1};
    const disc=r=>{ctx.beginPath();ctx.arc(cx,cy,r,0,TAU)};
    const glow=(r0,r1,st,ox,oy)=>{const g=ctx.createRadialGradient(cx+(ox||0),cy+(oy||0),r0,cx,cy,r1);st.forEach(s=>g.addColorStop(s[0],s[1]));ctx.fillStyle=g;disc(r1);ctx.fill()};
    const ORB=[[1.3,1.2,.4,1],[1.5,-.45,2.2,-1],[1.72,.18,4.1,1]];   /* [radius, tilt, phase, direction] of the light orbits (hologram) */
    const orbits=front=>{const fa=1-.75*zp;ctx.lineCap='round';
      for(const[r0,tl,a0,dr]of ORB){const ph=a0+(RM?0:S.time*.00003*dr),cp=Math.cos(ph),sp=Math.sin(ph),ct=Math.cos(tl),st=Math.sin(tl),r=r0*GR;
        const at=th=>{const x=Math.cos(th)*r,z0=Math.sin(th)*r,z1=z0*ct;return[x*cp+z1*sp,-z0*st,-x*sp+z1*cp]};
        ctx.strokeStyle='#3DF5C4';ctx.lineWidth=1;ctx.globalAlpha=fa*.26;ctx.beginPath();
        let p=at(0),ps=pj(p);
        for(let n=1;n<=96;n++){const q=at(n/96*TAU),s=pj(q);if((p[2]+q[2]<0)!==front){ctx.moveTo(ps[0],ps[1]);ctx.lineTo(s[0],s[1])}p=q;ps=s}
        ctx.stroke();
        if(!RM){const h=a0*3+S.time*.00055*dr;ctx.lineWidth=2;
          for(let n=0;n<18;n++){const q0=at(h-dr*n*.035),q1=at(h-dr*(n+1)*.035);if((q0[2]+q1[2]<0)===front)continue;const s0=pj(q0),s1=pj(q1);
            ctx.globalAlpha=fa*(1-n/18)*.9;ctx.strokeStyle=n<3?'#E6FFF8':'#3DF5C4';ctx.beginPath();ctx.moveTo(s0[0],s0[1]);ctx.lineTo(s1[0],s1[1]);ctx.stroke()}}}
      ctx.globalAlpha=1};
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
    /* stars far away: they turn with the globe, hidden behind it */
    ctx.fillStyle='#B9FFEA';
    for(const s of STARS){const q=rv(s);if(q[2]>-.25)continue;const k=F/-q[2],x=cx+q[0]*k,y=cy-q[1]*k;
      if(x<0||y<0||x>W||y>H||Math.hypot(x-cx,y-cy)<Rs*1.04)continue;ctx.globalAlpha=RM?.35:.12+.3*Math.abs(Math.sin(t/1700+s[3]));ctx.fillRect(x,y,s[4],s[4])}
    ctx.globalAlpha=1;
    /* the hologram: a glass globe, the land as a fine grid of light, glowing coasts, light orbits; the far side shows faintly through */
    glow(Rs*.9,Rs*1.4,[[0,'rgba(40,230,180,.22)'],[1,'rgba(40,230,180,0)']]);
    orbits(false);
    const bd=proj(geoDots(lo?Math.round(NDOT*.6):NDOT),'d'),bc=proj(G.coast.p,'c');
    dots(bd,false,1.1*sc,'#3DF5C4',.1,.1);
    path(G.coast,bc,false);ctx.strokeStyle='rgba(61,245,196,.16)';ctx.lineWidth=1;ctx.stroke();
    glow(0,Rs,[[0,'rgba(4,34,38,.55)'],[.75,'rgba(6,52,56,.62)'],[1,'rgba(20,110,100,.72)']]);
    glow(Rs*.7,Rs,[[0,'rgba(61,245,196,0)'],[1,'rgba(61,245,196,.3)']]);
    dots(bd,true,1.5*sc,'#3DF5C4',.3,.95);
    path(G.coast,bc,true);ctx.globalCompositeOperation='lighter';
    if(!lo){ctx.strokeStyle='rgba(61,245,196,.28)';ctx.lineWidth=3.2;ctx.stroke()}
    ctx.strokeStyle='rgba(185,255,233,.85)';ctx.lineWidth=1.1;ctx.stroke();ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle='rgba(120,255,220,.55)';ctx.lineWidth=1.4;disc(Rs);ctx.stroke();
    orbits(true);
    /* the sections: a glass badge on a thin stem above its place, back to front */
    S.hit=[];const zt=GR/D;
    const pins=C.map((c,i)=>{const v=rv(c.v),b0=[v[0]*GR,v[1]*GR,v[2]*GR],q=[b0[0]*HM,b0[1]*HM,b0[2]*HM];return{i,fz:v[2],b:pj(b0),q,s:pj(q)}}).sort((a,b)=>a.q[2]-b.q[2]);
    for(const o of pins){const r=R[o.i],sel=o.i===S.sel,x=o.s[0],y=o.s[1];
      let al=Math.max(0,Math.min(1,(o.fz-zt+.1)/.28));if(S.sel>=0&&!sel)al*=1-.8*zp;if(sel)al=1;
      if(al<.03)continue;
      const pr=20*Math.min(1.25,Math.max(.8,o.s[2]/k0))*(sel?1.08:1);
      ctx.globalAlpha=al*.85;ctx.strokeStyle=r.c;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(o.b[0],o.b[1]);ctx.lineTo(x,y);ctx.stroke();
      ctx.globalCompositeOperation='lighter';
      let g=ctx.createRadialGradient(o.b[0],o.b[1],0,o.b[0],o.b[1],7);g.addColorStop(0,r.c);g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(o.b[0],o.b[1],7,0,TAU);ctx.fill();
      g=ctx.createRadialGradient(x,y,pr*.7,x,y,pr*2.1);g.addColorStop(0,r.c);g.addColorStop(1,'rgba(0,0,0,0)');ctx.globalAlpha=al*.4;ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,pr*2.1,0,TAU);ctx.fill();
      ctx.globalCompositeOperation='source-over';
      if((r.open||sel)&&!RM){const ph=(t/1500+o.i*.27)%1;ctx.strokeStyle=r.c;ctx.globalAlpha=al*(1-ph)*.8;ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(x,y,pr+ph*14,0,TAU);ctx.stroke()}
      ctx.globalAlpha=al;ctx.fillStyle='rgba(7,13,30,.9)';ctx.beginPath();ctx.arc(x,y,pr,0,TAU);ctx.fill();ctx.lineWidth=sel?3:2;ctx.strokeStyle=r.c;ctx.stroke();
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.font=Math.round(pr*1.02)+'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';ctx.fillText(r.e,x,y+1);
      const la=sel?1:al*Math.max(0,Math.min(1,(o.fz-zt)/.25));
      if(la>.05){const sub=r.d+'/'+r.n;ctx.font='700 13px Inter,system-ui,sans-serif';
        const w1=ctx.measureText(r.l).width;ctx.font='600 12px Inter,system-ui,sans-serif';const w2=ctx.measureText(sub).width,w=w1+w2+26,ly=Math.min(y+pr+7,H-26);
        const lx=Math.max(4,Math.min(W-4-w,x-w/2));   /* keep the whole label inside the frame */
        ctx.globalAlpha=la;ctx.fillStyle='rgba(8,13,32,.86)';pill(lx,ly,w,23,11.5);ctx.fill();
        ctx.strokeStyle=r.c;ctx.lineWidth=1.5;ctx.stroke();ctx.textAlign='left';ctx.fillStyle='#fff';ctx.font='700 13px Inter,system-ui,sans-serif';ctx.fillText(r.l,lx+10,ly+12);
        ctx.fillStyle=r.c;ctx.font='600 12px Inter,system-ui,sans-serif';ctx.fillText(sub,lx+16+w1,ly+12)}
      ctx.globalAlpha=1;
      if(al>.5)S.hit.push({i:o.i,x,y:y+6,r:pr+14})}
  }
  /* left alone, the globe comes back upright (north up, tilted at most a little) */
  function upright(dt){
    const Q=qmat(S.q),n=[Q[1],Q[4],Q[7]];let a=Math.atan2(n[2],n[1]);a=Math.max(-.35,Math.min(.55,a));
    const nt=[0,Math.cos(a),Math.sin(a)],c=[n[1]*nt[2]-n[2]*nt[1],n[2]*nt[0]-n[0]*nt[2],n[0]*nt[1]-n[1]*nt[0]],l=Math.hypot(c[0],c[1],c[2]),d=n[0]*nt[0]+n[1]*nt[1]+n[2]*nt[2];
    const g=Math.atan2(l,d);if(g<1e-4)return;const ax=l>1e-6?[c[0]/l,c[1]/l,c[2]/l]:[1,0,0];
    S.q=qn(qm(qa(ax[0],ax[1],ax[2],g*(1-Math.exp(-dt/700))),S.q))}
  function frame(t){
    if(!cv.isConnected){if(ro)ro.disconnect();if(io)io.disconnect();return}
    requestAnimationFrame(frame);
    const raw=t-last,dt=Math.min(50,raw);last=t;if(!S.vis||!W)return;
    /* motion: a flight to a place, or the free spin (finger speed after a swipe), then the slow turn on the globe's own axis */
    if(S.tw){const k=Math.min(1,(t-S.tw.t0)/S.tw.d);S.q=qs(S.tw.q0,S.tw.q1,ease(k));if(k>=1)S.tw=null}
    else if(!S.drag){const wm=Math.hypot(S.w[0],S.w[1],S.w[2]),kk=1-Math.exp(-dt/(wm>AUTO*1.5?1100:500));
      S.w=S.w.map(v=>v*(1-kk));const m=wm*(1-kk);
      if(m>1e-8)S.q=qn(qm(qa(S.w[0]/m,S.w[1]/m,S.w[2]/m,m*dt),S.q));
      const ts=S.sel<0&&!RM&&!S.pinch?(S.hover?.3:1)*AUTO:0;S.sp+=(ts-S.sp)*(1-Math.exp(-dt/900));
      if(S.sp>1e-7)S.q=qn(qm(S.q,qa(0,1,0,S.sp*dt)));
      if(S.sel<0&&!S.pinch&&m<AUTO*3&&t-S.rel>1500)upright(dt)}
    const dD=S.Dt-S.D;S.D=Math.abs(dD)<1e-4||RM?S.Dt:S.D+dD*(1-Math.exp(-dt/240));
    M=qmat(S.q);
    if(!RM)S.time+=dt;
    const t0=performance.now();draw(t);const cost=performance.now()-t0;
    /* adaptive quality: when drawing is slow or frames come slower than ~25 fps, draw fewer pixels, then fewer dots and no glow
       (a steady 30 fps alone is not slow: phones in power saving mode cap the frame rate there) */
    if(raw<400){if(S.warm>0)S.warm--;else S.pf.push([raw,cost])}   /* a long gap = tab was hidden, not a slow frame */
    if(S.pf.length>=40){let a=0,c=0;S.pf.forEach(p=>{a+=p[0];c+=p[1]});a/=S.pf.length;c/=S.pf.length;S.pf=[];box.dataset.ms=c.toFixed(1);
      if((a>40||c>14)&&S.lq<2){S.lq++;S.warm=15;box.dataset.q='q'+S.lq;size()}}}
  const DIRF=(()=>{const l=Math.hypot(0,.2,1);return[0,.2/l,1/l]})();
  function mark(i){document.querySelectorAll('.glbchip').forEach(b=>{const on=+b.dataset.gi===i;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)});
    back.hidden=i<0;box.classList.toggle('zoomed',i>=0)}
  /* fly to the place: it comes to the front, north up, and the globe zooms in */
  function pick(i,anim){
    if(i===S.sel&&anim){unpick();return}
    const q1=qn(qm(qa(1,0,0,C[i].la-Math.asin(DIRF[1])),qa(0,1,0,-C[i].lo)));
    S.sel=i;ui.gsec=R[i].k;S.w=[0,0,0];S.Dt=DSEL;
    if(!anim||RM){S.q=q1;S.tw=null;S.D=DSEL}else S.tw={t0:performance.now(),d:1100,q0:S.q.slice(),q1};
    mark(i);panel.innerHTML=gpanelHTML(R[i],T);bindCards(panel);panel.querySelector('[data-gx]').onclick=()=>{sfx('tap');unpick()};
    if(anim){sfx('open');setTimeout(()=>{if(!panel.isConnected)return;const b=panel.getBoundingClientRect();
      if(b.top>innerHeight*.8)scrollTo({top:scrollY+b.top-innerHeight*.5,behavior:RM?'auto':'smooth'})},RM?0:750)}}
  function unpick(){S.sel=-1;ui.gsec=null;S.tw=null;S.Dt=DH;S.rel=performance.now();mark(-1);panel.innerHTML=''}
  /* pointers: one finger/mouse turns the globe in any direction (it follows the finger), two fingers pinch-zoom, a tap opens a place */
  const pts=new Map(),clampD=v=>Math.max(DMIN,Math.min(DMAX,v));
  const begin=(x,y)=>{S.drag={sx:x,sy:y,x,y,t:performance.now(),moved:false,tap:true};S.w=[0,0,0]};
  cv.addEventListener('pointerdown',e=>{pts.set(e.pointerId,[e.clientX,e.clientY]);try{cv.setPointerCapture(e.pointerId)}catch(_){}
    if(pts.size===1)begin(e.clientX,e.clientY);
    else if(pts.size===2){const[a,b]=[...pts.values()];S.pinch={d0:Math.hypot(a[0]-b[0],a[1]-b[1])||1,D0:S.Dt};if(S.drag)S.drag.tap=false;box.classList.add('used')}});
  cv.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(S.pinch&&pts.size>=2){const[a,b]=[...pts.values()];S.Dt=clampD(S.pinch.D0*S.pinch.d0/(Math.hypot(a[0]-b[0],a[1]-b[1])||1));return}
    const d=S.drag;if(!d)return;
    if(!d.moved&&Math.hypot(e.clientX-d.sx,e.clientY-d.sy)>7){d.moved=true;d.tap=false;S.tw=null;box.classList.add('used')}
    if(!d.moved)return;
    const dx=e.clientX-d.x,dy=e.clientY-d.y,l=Math.hypot(dx,dy),now=performance.now();if(l<.01)return;
    const F=Math.min(W,H)/2/TAN,g=l*S.D/(F*1.3),ax=dy/l,ay=dx/l;
    S.q=qn(qm(qa(ax,ay,0,g),S.q));
    const it=g/Math.max(8,now-d.t),wi=[ax*it,ay*it,0];S.w=S.w.map((v,i)=>v*.4+wi[i]*.6);
    const wm=Math.hypot(S.w[0],S.w[1],S.w[2]);if(wm>.012)S.w=S.w.map(v=>v*.012/wm);
    d.x=e.clientX;d.y=e.clientY;d.t=now});
  const end=e=>{const had=pts.delete(e.pointerId);if(!had)return;S.rel=performance.now();
    if(S.pinch){if(pts.size<2)S.pinch=null;if(pts.size===1){const[p]=[...pts.values()];begin(p[0],p[1]);S.drag.tap=false;S.drag.moved=true}else S.drag=null;return}
    const d=S.drag;S.drag=null;if(!d)return;
    if(d.moved){if(RM||performance.now()-d.t>90)S.w=[0,0,0];return}
    if(!d.tap||e.type!=='pointerup')return;
    box.classList.add('used');const b=cv.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;let best=null,bd=1e9;
    S.hit.forEach(h=>{const q=Math.hypot(h.x-x,h.y-y);if(q<h.r&&q<bd){bd=q;best=h}});
    if(best)pick(best.i,true);else if(S.sel>=0)unpick()};
  cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
  cv.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')S.hover=true});
  cv.addEventListener('pointerleave',()=>{S.hover=false});
  cv.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();S.Dt=clampD(S.Dt*Math.exp(e.deltaY*.002));box.classList.add('used')},{passive:false});
  box.querySelectorAll('[data-gz]').forEach(b=>b.onclick=()=>{sfx('tap');S.Dt=clampD(S.Dt*(b.dataset.gz==='1'?.8:1.25));box.classList.add('used')});
  document.querySelectorAll('.glbchip').forEach(b=>b.onclick=()=>pick(+b.dataset.gi,true));
  back.onclick=()=>{sfx('tap');unpick()};
  box.dataset.q='q0';
  size();
  const k0=R.findIndex(r=>r.k===ui.gsec);if(k0>=0)pick(k0,false);
  setTimeout(()=>box.classList.add('hinted'),5000);   /* the hint fades by itself so it never covers a label for long */
  requestAnimationFrame(frame)}
function podium(rows){
  const top=rows.filter(r=>r.r<=3&&r.t>0).slice(0,3);if(!top.length)return '';
  const order=[top[1],top[0],top[2]].filter(Boolean);
  return `<div class="pod">${order.map(r=>`<div class="pd p${Math.min(r.r,3)} ${r.me?'me':''}">${avHTML(r.a,r.n,lvIdx(r.t),'pdm')}<b>${esc(r.n)}</b><span>${r.t} XP</span><i>${r.r}</i></div>`).join('')}</div>`;
}
function ligaHTML(p){
  const rows=p.board||[];
  return `<h1 class="pgh">Reyting</h1>
  <p class="muted lgsub">${esc(p.student.type==='guest'?'Mehmonlar':p.student.group)} guruhi. XP ${G3?'topshiriqlar':'Booster testlari va topshiriqlar'} uchun beriladi.</p>
  ${podium(rows)}
  <div class="card lglist">${rows.map(r=>`<div class="lgr ${r.me?'me':''}"><span class="lgn">${r.r}</span>${avHTML(r.a,r.n,lvIdx(r.t),'xs')}<b>${esc(r.n)}${r.me?' <small>(siz)</small>':''}</b><span></span><span class="lgt">${r.t}<small> XP</small></span></div>`).join('')||'<div class="empty">Hali hech kim XP olmagan.</div>'}</div>
  <div class="card xprule"><b>XP qanday olinadi</b><p class="${G3?'hide':''}">Booster testini A–E bilan tugatsangiz: ${(p.rules&&p.rules.base)||10} XP va har bir to‘g‘ri javob uchun yana ${(p.rules&&p.rules.perOk)||2} XP.</p><p>Ustoz topshirig‘ining har bir bosqichini “Bajardim” desangiz: o‘sha topshiriq uchun belgilangan XP.</p><p>Platformaga ketma-ket kirgan kunlar uchun sovg‘a: ${GIFTS.map(g=>g[0]+' kun +'+g[1]).join(', ')} XP — har biri faqat bir marta.</p></div>`;
}

/* ================= PROFILE (Multi-Level, 25.11.2026): avatar + frame, days in a row, gifts, graphs ================= */
const AVS={fox:['🦊','#FFE3D1','Tulki'],lion:['🦁','#FFF0C2','Sher'],tiger:['🐯','#FFE6CC','Yo‘lbars'],panda:['🐼','#E6E9EF','Panda'],koala:['🐨','#E3E8F0','Koala'],owl:['🦉','#EFE2D3','Boyqush'],
  dolphin:['🐬','#DCEBFF','Delfin'],eagle:['🦅','#EDE3D8','Burgut'],wolf:['🐺','#E2E5EA','Bo‘ri'],bear:['🐻','#F1E1D3','Ayiq'],cat:['🐱','#FBE3EE','Mushuk'],penguin:['🐧','#DDF2FB','Pingvin'],
  butterfly:['🦋','#EADFFF','Kapalak',3],dragon:['🐉','#DDF5E4','Ajdar',7],unicorn:['🦄','#FBE0F1','Yagona shox',14],rocket:['🚀','#DCE6FF','Raketa',30],star:['🌟','#FFF1C9','Yulduz',60]};
/* [days in a row, XP given once, gift avatar, badge name] — the server counts the same (GIFTS in core.ts) */
const GIFTS=[[3,5,'butterfly','Uchqun'],[7,10,'dragon','Bir hafta'],[14,15,'unicorn','Ikki hafta'],[30,20,'rocket','Bir oy'],[60,30,'star','Ikki oy']];
const FRAMES=['Oddiy ramka','Moviy ramka','Yashil chaqmoq','Olovli ramka','Olmos ramka','Oltin toj'];
const lvIdx=x=>{let i=0;while(i<LVS.length-1&&(x||0)>=LVS[i+1][0])i++;return i};
function avHTML(av,name,tier,cls){const a=AVS[av];
  return `<span class="avf fr${tier==null?'x':tier} ${cls?'z'+cls:''}" aria-hidden="true"><span class="avi${a?' em':''}" ${a?`style="background:${a[1]}"`:''}>${a?a[0]:esc(initials(name))}</span></span>`}
const dnum=d=>Math.round(Date.parse(d+'T00:00:00Z')/864e5);
const dstr=n=>new Date(n*864e5).toISOString().slice(0,10);
const WD=['Ya','Du','Se','Ch','Pa','Ju','Sh'];
const dmY=t=>{const d=new Date(t);return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')};
const agoUz=t=>{if(!t)return 'hech qachon';const d=(Date.now()-t)/60000;if(d<2)return 'hozirgina';if(d<60)return Math.round(d)+' daqiqa oldin';if(d<1440)return Math.round(d/60)+' soat oldin';const n=Math.round(d/1440);return n===1?'kecha':n+' kun oldin'};
const hm=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const durUz=s=>s==null?'':s<60?s+' soniya':Math.floor(s/60)+' daq'+(s%60&&s<600?' '+(s%60)+' s':'');
function actOf(p){const a=(p&&p.act)||{};return{cur:a.cur||0,best:a.best||0,total:a.total||0,today:!!a.today,days:a.days||[],gifts:a.gifts||[],now:a.now||new Date().toISOString().slice(0,10)}}
const pctOf=r=>r&&r.of?Math.round(r.ok/r.of*100):0;
const pcCls=p=>p>=80?'g':p>=50?'y':'r';
/* which skill a result belongs to: the map's banner, else the kind of material */
function skillOf(r,asg){if(r.k==='bx')return 'Booster';if(r.k==='exam')return 'Mock test';
  /* General English 3 units (g3u5a …): the exercise id says the skill (r1 Reading, v1/vb1 Lug‘at, g1 Grammatika, wg1 = Workbook g1 …) */
  if(/^g3u\d+[a-z]$/.test(r.d||'')){const k=String(r.x||'').replace(/^w(?=[a-z]\d)/,'').charAt(0);return {g:'Grammatika',v:'Lug‘at',p:'Talaffuz',l:'Listening',r:'Reading',x:'Gap tuzish',k:'Writing'}[k]||'Mashqlar'}
  if(r.k==='gr')return 'Grammatika';
  const a=r.a&&(asg||[]).find(x=>x.aid===r.a),c=a&&a.cover;
  if(c){if(/^(reading|rp3|rp2)$/.test(c))return 'Reading';if(/^(listening|lmock)$/.test(c))return 'Listening';if(c==='vocab')return 'Lug‘at';if(c==='grammar')return 'Grammatika';if(/^(wr1|wr2|writing)$/.test(c))return 'Writing'}
  const d=r.d||'';return /^gr/.test(d)?'Grammatika':/^voc|^v\d/.test(d)?'Lug‘at':/^l/.test(d)?'Listening':/^r/.test(d)?'Reading':'Mashqlar'}
/* a small line chart (SVG, no library): pts = [{l:label, v:value}] */
function lineChart(pts,o){o=o||{};const W=640,H=200,pl=34,pr=14,pt=16,pb=28,n=pts.length;if(!n)return '';
  const min=o.min!=null?o.min:Math.min(...pts.map(p=>p.v)),max=o.max!=null?o.max:Math.max(1,...pts.map(p=>p.v));const sp=max-min||1;
  const X=i=>n===1?(pl+W-pr)/2:pl+i*(W-pl-pr)/(n-1),Y=v=>pt+(H-pt-pb)*(1-(v-min)/sp);
  const line=pts.map((p,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area=`${line} L${X(n-1).toFixed(1)},${H-pb} L${X(0).toFixed(1)},${H-pb} Z`;const id='lg'+Math.random().toString(36).slice(2,7);
  const grid=(o.grid||[min,min+sp/2,max]).map(v=>`<line x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" class="cgl"/><text x="${pl-6}" y="${Y(v)+4}" text-anchor="end" class="ctx">${Math.round(v)}${o.unit||''}</text>`).join('');
  const bands=(o.bands||[]).map(([v,l])=>`<line x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" class="cbd"/><text x="${W-pr}" y="${Y(v)-4}" text-anchor="end" class="cbl">${l}</text>`).join('');
  const step=Math.max(1,Math.ceil(n/8));
  const lbl=pts.map((p,i)=>i===n-1||(i%step===0&&n-1-i>=step)?`<text x="${X(i)}" y="${H-8}" text-anchor="middle" class="ctx">${esc(p.l)}</text>`:'').join('');
  const dots=pts.map((p,i)=>`<circle cx="${X(i)}" cy="${Y(p.v)}" r="${n>24?2.5:4}" class="cdot"><title>${esc(p.l)}: ${esc(p.t||Math.round(p.v)+(o.unit||''))}</title></circle>`).join('');
  const last=pts[n-1];
  return `<svg class="lchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label||'Grafik')}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cc)" stop-opacity=".32"/><stop offset="1" stop-color="var(--cc)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${bands}<path d="${area}" fill="url(#${id})"/><path d="${line}" class="cln"/>${dots}${lbl}
    <text x="${Math.min(X(n-1),W-pr-4)}" y="${Math.max(12,Y(last.v)-10)}" text-anchor="end" class="cval">${esc(last.t||Math.round(last.v)+(o.unit||''))}</text></svg>`}
/* the XP line: every finished step and Booster test at its time, then today's total */
function xpLine(p){const ev=[];const A={};(p.assignments||[]).forEach(a=>A[a.aid]=a);
  Object.entries(p.pat||{}).forEach(([k,t])=>{const a=A[k.split(':')[0]];if(a&&t)ev.push([t,a.xp])});
  Object.values(((p.booster||{}).tests)||{}).forEach(x=>{if(x&&x.kwt&&x.res&&x.res.at)ev.push([x.res.at,bxp(p,x.res.score)])});
  ev.sort((a,b)=>a[0]-b[0]);const by=new Map();let s=0;ev.forEach(([t,x])=>{s+=x;by.set(new Date(t).toDateString(),[t,s])});
  const pts=[...by.values()].slice(-20).map(([t,v])=>({l:dmY(t),v}));
  const T=(p.xp&&p.xp.T)||0;if(!pts.length||pts[pts.length-1].v!==T)pts.push({l:'bugun',v:T});return pts}
function heatHTML(days,now,weeks){const set=new Set(days),end=dnum(now),wd=new Date(now+'T12:00:00Z').getUTCDay(),last=end+(6-((wd+6)%7));
  const first=last-weeks*7+1;let cols='';
  for(let w=0;w<weeks;w++){let c='';for(let d=0;d<7;d++){const n=first+w*7+d,s=dstr(n);c+=`<i class="${n>end?'fu':set.has(s)?'on':''}" title="${s}"></i>`}cols+=`<span>${c}</span>`}
  return `<div class="heatw"><div class="heatl" aria-hidden="true"><span>Du</span><span></span><span>Ch</span><span></span><span>Ju</span><span></span><span>Ya</span></div><div class="heat" role="img" aria-label="Faol kunlar: ${set.size} kun">${cols}</div></div>
    <div class="heatk" aria-hidden="true"><i></i> kirmagan <i class="on"></i> platformaga kirgan</div>`}
function weekStrip(a){const end=dnum(a.now),set=new Set(a.days);let h='';
  for(let n=end-6;n<=end;n++){const s=dstr(n),wd=new Date(s+'T12:00:00Z').getUTCDay();h+=`<span class="wk ${set.has(s)?'on':''} ${n===end?'td':''}"><i>${set.has(s)?'🔥':n===end?'·':''}</i><small>${WD[wd]}</small></span>`}
  return `<div class="wks">${h}</div>`}
function profHTML(p){
  const s=p.student,a=actOf(p),x=p.xp||{T:0},li=lvIdx(x.T),lv=stLevel(x.T),rk=myRank(p),T=tracks(p);
  const R=(p.res||[]).slice().sort((q,w)=>q.at-w.at),nx=GIFTS.find(g=>a.best<g[0]);
  const all=T.reduce((q,t)=>q+t.total,0),dn=T.reduce((q,t)=>q+t.done,0);
  const avg=R.length?Math.round(R.reduce((q,r)=>q+pctOf(r),0)/R.length):null;
  const acc=R.slice(-20).map(r=>({l:dmY(r.at),v:pctOf(r),t:r.ok+'/'+r.of+' · '+pctOf(r)+'%'}));
  const ex=R.filter(r=>r.k==='exam'&&r.b!=null).map(r=>({l:dmY(r.at),v:r.b,t:r.b+' ball · '+(r.lv||'')}));
  const sk={};R.forEach(r=>{const k=skillOf(r,p.assignments);(sk[k]=sk[k]||[]).push(pctOf(r))});
  const skills=Object.entries(sk).map(([k,v])=>[k,Math.round(v.reduce((q,w)=>q+w,0)/v.length),v.length]).sort((q,w)=>w[2]-q[2]);
  const xl=xpLine(p);
  return `<section class="pfh">
    <button class="pfav" id="pfAv" aria-label="Rasmni almashtirish">${avHTML(p.av,s.name,li,'xl')}<span class="pfed">✎</span></button>
    <div class="pfn"><h1>${esc(s.name)}</h1><div class="st-meta">${s.type==='guest'?'<span>Mehmon</span>':`<span>ID ${esc(s.id)}</span><span>${esc(s.group)}</span>`}</div>
      <div class="pfb"><span class="pflv">${lv.ic} ${esc(lv.n)}</span><span class="pffr">${esc(FRAMES[li])}</span></div></div>
    <div class="pfx"><b>${x.T}</b><small>XP</small></div>
  </section>
  <section class="card pfs">
    <div class="pfsh"><div class="flame ${a.cur?'on':''}">🔥<b>${a.cur}</b></div>
      <div><h2>${a.cur?a.cur+' kun ketma-ket':'Seriya hali yo‘q'}</h2><p class="muted">${a.today?'Bugun kirdingiz ✓ Ertaga ham kiring — seriya uzilmasin!':a.cur?'Bugun ham kiring — seriya uzilmasin!':'Har kuni platformaga kiring: 3 kunda birinchi sovg‘a!'}</p>
        <div class="pfst2"><span>🏅 Eng uzun: <b>${a.best} kun</b></span><span>📅 Jami: <b>${a.total} kun</b></span></div></div></div>
    ${weekStrip(a)}
    ${nx?`<div class="pfnx"><div><b>🎁 Keyingi sovg‘a: ${nx[0]} kun ketma-ket</b><small>${AVS[nx[2]][0]} ${esc(AVS[nx[2]][2])} avatari + ${nx[1]} XP · yana ${Math.max(1,nx[0]-a.cur)} kun</small></div><div class="lvbar"><b style="width:${Math.min(100,Math.round(a.cur/nx[0]*100))}%"></b></div></div>`:'<div class="pfnx"><b>🏆 Barcha sovg‘alarni oldingiz! Siz haqiqiy chempionsiz.</b></div>'}
  </section>
  <h2 class="sech">Sovg‘alar</h2>
  <div class="gifts">${GIFTS.map(g=>{const got=a.best>=g[0],av=AVS[g[2]];return `<div class="gift ${got?'got':''}"><div class="gbx">${got?av[0]:'🎁'}</div><b>${g[0]} kun</b><small>${got?esc(av[2])+' · +'+g[1]+' XP':'+'+g[1]+' XP · avatar'}</small><span class="gtag">${got?'✓ Olindi':a.cur?Math.min(a.cur,g[0])+'/'+g[0]:'🔒'}</span></div>`}).join('')}</div>
  <p class="muted gnote">Sovg‘a XP har bir sovg‘a uchun faqat bir marta beriladi — hammaga adolatli.</p>
  <h2 class="sech">Natijalarim</h2>
  <div class="pft">
    <div class="card"><b>${rk?rk.me.r+'<small>-o‘rin</small>':'–'}</b><span>${s.type==='guest'?'mehmonlar':esc(s.group)} guruhida</span></div>
    <div class="card"><b>${dn}<small>/${all}</small></b><span>bosqich bajarildi</span></div>
    <div class="card"><b>${R.length}</b><span>tekshirilgan mashq</span></div>
    <div class="card"><b>${avg==null?'–':avg+'<small>%</small>'}</b><span>o‘rtacha natija</span></div>
  </div>
  <div class="card pfc"><h3>Mashqlardagi natijalar <small>oxirgi ${acc.length} ta, foizda</small></h3>
    ${acc.length?`<div class="cwrap" style="--cc:#E3101F">${lineChart(acc,{min:0,max:100,unit:'%',grid:[0,50,100],label:'Mashqlardagi natijalar'})}</div>`:'<p class="muted empty">Mashq bajarib, “Javoblarni tekshirish”ni bossangiz, natijangiz shu yerda chiziq bo‘lib chiqadi.</p>'}</div>
  <div class="card pfc"><h3>XP o‘sishi</h3>${xl.length>1?`<div class="cwrap" style="--cc:#2457D6">${lineChart(xl,{min:0,label:'XP o‘sishi'})}</div>`:'<p class="muted empty">XP to‘plaganingiz sari bu chiziq yuqoriga ko‘tariladi.</p>'}</div>
  ${ex.length?`<div class="card pfc"><h3>Mock testlar <small>ball, 75 dan</small></h3><div class="cwrap" style="--cc:#159947">${lineChart(ex,{min:0,max:75,grid:[0,38,75],bands:[[38,'B1'],[51,'B2'],[65,'C1']],label:'Mock testlar'})}</div></div>`:''}
  ${skills.length?`<div class="card pfc"><h3>Ko‘nikmalar <small>o‘rtacha foiz</small></h3><div class="skl">${skills.map(([k,v,n])=>`<div class="skr"><span>${esc(k)}<small>${n} ta</small></span><div class="skb"><b class="${pcCls(v)}" style="width:${Math.max(3,v)}%"></b></div><em>${v}%</em></div>`).join('')}</div></div>`:''}
  <div class="card pfc"><h3>Faollik kalendari <small>oxirgi 12 hafta</small></h3>${heatHTML(a.days,a.now,12)}</div>
  <h2 class="sech">Ramkalar — qanday almashadi?</h2>
  <div class="card frl"><p class="muted">Ramkangiz XP darajangizga qarab <b>o‘zi almashadi</b>. XP — ${G3?'':'Booster testlari, '}topshiriq bosqichlari va kunlik seriya sovg‘alari uchun beriladi.</p>
    <div class="frs">${LVS.map((l,i)=>`<div class="fr ${i===li?'on':i<li?'pass':''}">${avHTML(p.av,s.name,i,'md')}<b>${l[1]} ${esc(l[2])}</b><small>${l[0]} XP${i===li?' · siz shu yerdasiz':i<li?' · ✓':' · yana '+(l[0]-x.T)+' XP'}</small><span>${esc(FRAMES[i])}</span></div>`).join('')}</div></div>
  ${R.length?`<h2 class="sech">So‘nggi natijalar</h2><div class="card rlist">${R.slice(-10).reverse().map(r=>`<div class="rrow"><span class="rsc ${pcCls(pctOf(r))}">${r.k==='exam'&&r.b!=null?r.b:r.ok+'/'+r.of}</span><span class="rtx"><b>${esc(r.ti||'Mashq')}</b><small>${dmY(r.at)} ${hm(r.at)}${r.sec?' · '+durUz(r.sec):''}${r.k==='exam'&&r.lv?' · '+esc(r.lv):''}</small></span><em>${pctOf(r)}%</em></div>`).join('')}</div>`:''}
  ${fxHTML()}`;
}
/* "Ovoz va tebranish" (26.11.2026): this device's FEEL settings, also used by the exercise and grammar pages */
function fxHTML(){const row=(id,on,t,d)=>`<label class="fxrow" data-press><span class="fxt"><b>${t}</b><small>${d}</small></span><input type="checkbox" class="fxsw" role="switch" id="${id}"${on?' checked':''}></label>`;
  return `<h2 class="sech">Ovoz va tebranish</h2><div class="card fxset">${row('fxSnd',FEEL.get('snd'),'🔊 Ovozlar','Tanlash, to‘g‘ri va xato javob, yutuqlar ovozi')}${FEEL.canHaptic()?row('fxHap',FEEL.get('hap'),'📳 Tebranish','Tugma bosilganda telefon yengil tebranadi'):''}</div>`}
function bindFx(){const s=$('#fxSnd'),h=$('#fxHap');
  if(s)s.onchange=()=>{FEEL.set('snd',s.checked);if(s.checked)FEEL.sound('pop')};
  if(h)h.onchange=()=>{FEEL.set('hap',h.checked);if(h.checked)FEEL.haptic('success')}}
function bindProf(){const b=$('#pfAv');if(b)b.onclick=avPick;bindFx()}
function avPick(){const a=actOf(P),cur=P.av||'';
  const cell=(k,v)=>{const lock=v[3]&&a.best<v[3];return `<button class="avc ${k===cur?'on':''} ${lock?'lock':''}" data-av="${k}" ${lock?'aria-disabled="true"':''} aria-label="${esc(v[2])}"><span class="avi em" style="background:${v[1]}">${v[0]}</span><small>${lock?'🔒 '+v[3]+' kun':esc(v[2])}</small></button>`};
  modal(`<h3>Rasmingizni tanlang</h3><p class="muted" style="margin:4px 0 10px">Maxsus rasmlar ketma-ket kirgan kunlar uchun sovg‘a bo‘lib ochiladi.</p>
    <div class="avg">${Object.entries(AVS).filter(([,v])=>!v[3]).map(([k,v])=>cell(k,v)).join('')}</div>
    <h4 class="avh">🎁 Sovg‘a rasmlar</h4><div class="avg">${Object.entries(AVS).filter(([,v])=>v[3]).map(([k,v])=>cell(k,v)).join('')}</div>
    <button class="btn ghost block" data-av="" style="margin-top:10px">Bosh harflar (${esc(initials(P.student.name))})</button>`,[{t:'Yopish'}]);
  document.querySelectorAll('.modal-bg [data-av]').forEach(b=>b.onclick=async()=>{const k=b.dataset.av,v=AVS[k];
    if(v&&v[3]&&a.best<v[3]){sfx('lock');toast(`Bu rasm ${v[3]} kun ketma-ket kirsangiz ochiladi`);return}
    sfx('tap');const old=P.av;P.av=k;store(ST+'p:'+U.id,JSON.stringify(P));closeModals();drawMe();
    try{const j=await cpost({action:'setAv',id:U.id,t:U.t,av:k});if(!j||!j.ok)throw 0;toast('Rasm saqlandi')}catch(e){P.av=old;store(ST+'p:'+U.id,JSON.stringify(P));drawMe();toast('Saqlanmadi. Internetni tekshiring.')}})}
/* a new streak gift: the box shakes, opens, shows the avatar, the badge and the XP */
function giftCheck(){if(!P||!P.act||!U)return;const k=ST+'gifts:'+U.id;let seen=[];try{seen=JSON.parse(store(k)||'[]')||[]}catch(e){}
  const got=P.act.gifts||[],nw=got.filter(g=>!seen.includes(g));if(!nw.length||$('.giftbg'))return;
  store(k,JSON.stringify(got));const g=GIFTS.find(x=>x[0]===Math.max(...nw));if(!g)return;const av=AVS[g[2]];
  const gx=GIFTS.filter(x=>nw.includes(x[0])).reduce((q,x)=>q+x[1],0);   /* two milestones reached at once (e.g. 3 and 7 days): both XP shown */
  const d=document.createElement('div');d.className='giftbg';d.setAttribute('role','dialog');d.setAttribute('aria-label','Sovg‘a');
  d.innerHTML=`<div class="giftc"><small>🔥 ${g[0]} kun ketma-ket!</small><h3>Sizga sovg‘a bor!</h3><button class="gbox" id="gOpen" aria-label="Sovg‘ani ochish">🎁</button><p class="muted">Qutini bosing</p></div>`;
  document.body.appendChild(d);sfx('open');
  $('#gOpen').onclick=()=>{sfx('grand');confetti();d.querySelector('.giftc').innerHTML=`<small>🏅 “${esc(g[3])}” nishoni</small><h3>${esc(av[2])} avatari ochildi!</h3>
    <div class="gwin"><span class="avi em" style="background:${av[1]}">${av[0]}</span></div><p class="gxp">+${gx} XP</p><p class="muted">Bu sovg‘a faqat bir marta beriladi. Keyingisi: ${(GIFTS.find(x=>x[0]>g[0])||[0])[0]?((GIFTS.find(x=>x[0]>g[0]))[0]+' kun ketma-ket'):'barchasi olindi!'}</p>
    <div class="gbtn"><button class="btn red big" id="gSet">Avatarni qo‘yish</button><button class="btn ghost big" id="gOk">Ajoyib!</button></div>`;
    $('#gOk').onclick=()=>d.remove();
    $('#gSet').onclick=async()=>{d.remove();P.av=g[2];store(ST+'p:'+U.id,JSON.stringify(P));drawMe();try{const j=await cpost({action:'setAv',id:U.id,t:U.t,av:g[2]});if(!j||!j.ok)throw 0;toast('Yangi avatar qo‘yildi')}catch(e){toast('Saqlanmadi')}}}}
/* results the exercise pages could not send wait on this device (ST+'rq:'+id); they go out with the next page load */
async function rqFlush(){if(!U||U.role!=='student')return;const k=ST+'rq:'+U.id;let q=[];try{q=JSON.parse(store(k)||'[]')}catch(e){}if(!q.length||ui.rqBusy)return;ui.rqBusy=true;const sent=[];
  for(const b of q){try{const j=await cpost(Object.assign({},b,{action:'res',id:U.id,t:U.t,v:'ml'}));if(j&&(j.ok||j.error==='bad'))sent.push(b.cid)}catch(e){}}
  let now=[];try{now=JSON.parse(store(k)||'[]')}catch(e){}const left=now.filter(b=>!sent.includes(b.cid));store(k,left.length?JSON.stringify(left):null);ui.rqBusy=false;if(sent.length)lastFetch=0}
function sendRes(b){if(!U||U.role!=='student')return;const k=ST+'rq:'+U.id;let q=[];try{q=JSON.parse(store(k)||'[]')}catch(e){}
  b.cid=Date.now().toString(36)+Math.random().toString(36).slice(2,8);q.push(b);store(k,JSON.stringify(q.slice(-40)));rqFlush()}

/* ---------- the journey map ---------- */
function mapHTML(p,t){
  const earned=t.steps.reduce((s,x)=>s+(x.done?x.xp||0:0),0);
  return `<div class="mapwrap">
    <div class="maphead">
      <div><h1>${esc(t.title)}</h1><p>${t.done}/${t.total} bosqich · ${earned} XP</p></div>${sndBtn()}
    </div>
    <div class="mapprog"><b style="width:${t.done/t.total*100}%"></b></div>
    <div class="map" id="map" aria-label="Yo‘l xaritasi"></div>
  </div>
  <div class="sheet-bg hide" id="sheetBg"></div><div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-hidden="true"></div>`;
}
function layoutMap(p,t){
  const box=$('#map');if(!box)return;const W=Math.min(box.clientWidth,460);const n=t.steps.length;
  const gap=t.booster?118:128,top=84;const amp=W*0.30,cx=W/2;
  const pos=i=>({x:cx+Math.sin(i*1.05)*amp,y:top+i*gap});
  const endY=top+n*gap+40;
  const pts=[...t.steps.map((_,i)=>pos(i)),{x:cx,y:endY}];
  const seg=(a,b)=>{const my=(a.y+b.y)/2;return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`};
  let paths='';for(let i=0;i<pts.length-1;i++){const done=i<t.steps.length&&t.steps[i].done&&(i+1>=t.steps.length||t.steps[i+1].done||i+1===t.cur);paths+=`<path d="${seg(pts[i],pts[i+1])}" class="${t.steps[i].done?'pdone':'plock'}"/>`}
  let html=`<svg class="mapsvg" width="${W}" height="${endY+110}" viewBox="0 0 ${W} ${endY+110}" aria-hidden="true">${paths}</svg>`;
  if(t.booster)[0,10,20].forEach((k,j)=>{if(k<n)html+=`<div class="mregion" style="top:${pos(k).y-62}px">${j+1}-to‘plam · Test ${k+1}–${Math.min(k+10,n)}</div>`});
  t.steps.forEach((s,i)=>{const q=pos(i);const st=s.done?'done':i===t.cur?'cur':'lock';
    html+=`<button class="mnode ${st}" data-i="${i}" style="left:${q.x}px;top:${q.y}px" aria-label="${esc(s.t)}${s.done?', bajarilgan':i===t.cur?', joriy bosqich':', yopiq'}">
      ${s.done?IC.check:st==='lock'?IC.lock:`<span class="mn">${i+1}</span>`}
      ${st==='cur'?`<span class="mhere ${q.x>cx?'l':'r'}">Siz shu yerdasiz</span>`:''}
      ${st==='cur'&&t.booster?'':`<span class="mlbl">${esc(t.booster?String(i+1):s.t)}${s.done&&s.score!=null?` · ${s.score}/6`:''}</span>`}</button>`});
  const fin=t.finished;
  html+=`<button class="mnode goal ${fin?'done':'lock'}" data-goal="1" style="left:${cx}px;top:${endY}px" aria-label="Sertifikat">${IC.trophy}<span class="mlbl">${fin?'Sertifikat':'Oxirida: sertifikat'}</span></button>`;
  box.style.height=(endY+110)+'px';box.style.width=W+'px';box.innerHTML=html;
  const bx=box.getBoundingClientRect();box.querySelectorAll('.mlbl').forEach(l=>{const r=l.getBoundingClientRect();const dx=r.left<bx.left+2?bx.left+2-r.left:r.right>bx.right-2?bx.right-2-r.right:0;if(dx)l.style.transform=`translateX(calc(-50% + ${Math.round(dx)}px))`});
}
function bindMap(p,t){
  bindSnd();layoutMap(p,t);
  ui.onResize=()=>layoutMap(p,t);
  const key=ST+'seen:'+p.student.id+':'+t.aid;const raw=store(key);const seen=raw==null?null:+raw;const fresh=seen!=null&&t.done>seen;store(key,String(t.done));
  $('#map').onclick=e=>{const b=e.target.closest('.mnode');if(!b)return;
    if(b.dataset.goal){if(t.finished){sfx('grand');certificate(p,t)}else{sfx('lock');toast('Avval barcha bosqichlarni tugating')}return}
    const i=+b.dataset.i,s=t.steps[i];
    if(!s.done&&i!==t.cur){sfx('lock');b.classList.remove('shake');void b.offsetWidth;b.classList.add('shake');toast('Avval oldingi bosqichni tugating');return}
    sfx('tap');openSheet(p,t,i)};
  const cur=$('#map .mnode.cur')||$('#map .mnode.goal');
  if(cur)setTimeout(()=>cur.scrollIntoView({block:'center',behavior:fresh?'smooth':'auto'}),fresh?500:50);
  if(fresh){const gained=t.steps.slice(seen,t.done).reduce((s,x)=>s+(x.xp||0),0);
    setTimeout(()=>{t.finished?sfx('grand'):sfx('win');confetti();xpPop(gained,t.finished)},350);
    const last=document.querySelector(`#map .mnode[data-i="${t.done-1}"]`);if(last)last.classList.add('pop')}
}
/* our own pages open in the same tab and get the map + step, so their "Bajardim" can come back here */
const ownPage=l=>/^(viewer|mashq|grammar|lb)\.html/.test(l||'');
const grLesson=l=>/^(?:grammar|mashq)\.html#d=gr\d[a-z0-9-]*&x=n\d/.test(l||'');   /* the grammar lesson: read to the end, nothing to check */
const lbStep=l=>/^lb\.html#d=lb\d/.test(l||'');   /* one test of a Listening booster (28.11.2026): five stages A–E, "Bajardim" is on its report page */
function stepHref(l,aid,i){return ownPage(l)?`${l}&a=${encodeURIComponent(aid)}&s=${i}`:l}
function xpPop(n,fin){const d=document.createElement('div');d.className='xppop';d.innerHTML=`<b>+${n} XP</b><span>${fin?'Hammasi tugadi! Sertifikat tayyor':'Keyingi bosqich ochildi'}</span>`;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
function openSheet(p,t,i){
  const s=t.steps[i];const sh=$('#sheet'),bg=$('#sheetBg');
  let body;
  if(t.booster){const n=i+1;
    body=`<div class="shk">${n}-test · ${s.pack}-to‘plam</div><h3>Reading Part 1, Test ${n}</h3>
      <p class="muted">${s.done?`Bajarilgan: o‘qish ${s.score}/6, ${s.xp} XP. Xohlasangiz qayta ishlashingiz mumkin.`:`Matnni o‘qing, bo‘sh joylarni to‘ldiring, so‘ng A–E mashqlarini bajaring. Tugatsangiz ${bxp(p,0)}–${bxp(p,6)} XP olasiz.`}</p>
      <div class="shb"><a class="btn red big block" href="#/me/b/${n}" id="shGo">${s.done?'Qayta ishlash':'Boshlash'}</a></div>`}
  else{const ex=isExam(s.l),er=ex?examRes(s.l):null,inf=er?resText(er):s.info;
    body=`<div class="shk">${ex?'Mock test · bitta o‘tirishda':`${i+1}-bosqich / ${t.total}`}</div><h3>${esc(s.t)}</h3>
      <p class="muted">${s.done?'Bu bosqich bajarilgan.'+(inf?' Natija: '+esc(inf)+'.':''):ex?`Barcha qismlar bitta testda, vaqt to‘xtamaydi. Testni yakunlab, natija sahifasida “Bajardim”ni bossangiz ${t.xpEach} XP va sertifikat olasiz.`:grLesson(s.l)?`Darsni oching va oxirigacha o‘qing: oxirida “Bajardim” tugmasi chiqadi. ${t.xpEach} XP olasiz.`:lbStep(s.l)?`Testni oching va 5 ta bosqichni (A–E) oxirigacha bajaring: hisobot sahifasida “Bajardim” tugmasi chiqadi. ${t.xpEach} XP olasiz.`:ownPage(s.l)?`Mashqni oching va oxirigacha bajaring: javoblar tekshirilgach “Bajardim” tugmasi chiqadi. ${t.xpEach} XP olasiz.`:`Topshiriqni bajaring va “Bajardim” ni bosing. ${t.xpEach} XP olasiz.`}</p>
      <div class="shb">${s.l?`<a class="btn ${s.done?'ghost':'red'} big block" href="${esc(stepHref(s.l,t.aid,i))}" ${ownPage(s.l)?'':'target="_blank" rel="noopener"'} id="shOpen">${ex?(s.done||er?'Natijani ko‘rish':'Testni ochish'):'Ochish'}</a>`:''}
        ${s.done||ex||ownPage(s.l)?'':`<button class="btn ${s.l?'ghost':'red'} big block" id="shDone">Bajardim</button>`}</div>`}
  sh.innerHTML=`<div class="grab"></div>${body}<button class="btn ghost block" id="shClose">Yopish</button>`;
  sh.classList.add('on');sh.setAttribute('aria-hidden','false');bg.classList.remove('hide');
  const close=()=>{sh.classList.remove('on');sh.setAttribute('aria-hidden','true');bg.classList.add('hide')};
  bg.onclick=close;$('#shClose').onclick=close;
  const go_=$('#shGo');if(go_)go_.onclick=()=>{sfx('open');close()};
  const op=$('#shOpen');if(op)op.onclick=()=>{sfx('open');stepMark(p,t,i,'opened')};
  const dn=$('#shDone');if(dn)dn.onclick=()=>{close();stepMark(p,t,i,'done')};
  setTimeout(()=>{const f=sh.querySelector('.btn.red,.btn');if(f)f.focus()},60);
}
async function stepMark(p,t,i,status,info0){
  const aid=t.aid+':'+i;const cur=(P.progress||{})[aid];if(cur==='done'||cur===status)return;
  P.progress=P.progress||{};P.progress[aid]=status;
  if(status==='done'){P.xp.A+=t.xpEach;P.xp.an++;P.xp.T+=t.xpEach;const me=(P.board||[]).find(r=>r.me);if(me)me.t=P.xp.T}
  store(ST+'p:'+U.id,JSON.stringify(P));
  const info=status==='done'?(info0||resText(examRes(t.steps[i].l))||''):'';if(info){P.info=P.info||{};P.info[aid]=info;store(ST+'p:'+U.id,JSON.stringify(P))}
  if(status==='done')drawMe();
  const body=Object.assign({action:'mark',id:U.id,t:U.t,aid,status},info?{info}:{});
  try{const j=await cpost(body);if(!j||!j.ok)throw 0;if(status==='done')lastFetch=0}catch(e){if(status==='done')qPush(body)}
}
/* marks that could not reach the server wait here and are re-sent on the next load */
const qKey=()=>ST+'q:'+U.id;
function qGet(){try{return JSON.parse(store(qKey())||'[]')}catch(e){return []}}
function qPush(b){const q=qGet().filter(x=>x.aid!==b.aid||x.action!==b.action);q.push(b);store(qKey(),JSON.stringify(q))}
async function qFlush(){const q=qGet();if(!q.length)return;const left=[];for(const b of q){try{const j=await cpost(Object.assign({},b,{t:U.t}));if(!j||!j.ok)left.push(b)}catch(e){left.push(b)}}store(qKey(),left.length?JSON.stringify(left):null);if(left.length<q.length)lastFetch=0}
function qApply(p){qGet().forEach(b=>{if(b.action==='mark'&&b.status==='done'){p.progress=p.progress||{};if(p.progress[b.aid]!=='done'){p.progress[b.aid]='done';const a=(p.assignments||[]).find(x=>b.aid.startsWith(x.aid+':'));if(a){p.xp.A+=a.xp;p.xp.an++;p.xp.T+=a.xp}}if(b.info){p.info=p.info||{};p.info[b.aid]=b.info}}});bxApply(p);return p}
/* proof that a step was really done: mashq saves the checked result on this device */
function stepProof(l){const m=/^(?:mashq|grammar|lb)\.html#d=([a-z0-9-]+)&x=([\w-]+)/.exec(l||'');if(!m)return{ok:true};
  if(m[2]==='all'){const r=examRes(l);return r?{ok:true,info:resText(r)}:{ok:false,msg:'Avval testni oxirigacha ishlang'}}
  let s=null;try{s=JSON.parse(store(ST+'mashq:'+U.id+':'+m[1]+':'+m[2])||'null')}catch(e){}
  if(lbStep(l))return s&&s.done&&s.r&&s.r.of?{ok:true,info:String(s.r.inf||s.r.ok+'/'+s.r.of+' to‘g‘ri').slice(0,80)}:{ok:false,msg:'Avval testning 5 ta bosqichini oxirigacha bajaring'};   /* a booster test: all five stages; the line "A 6/8 · B 7/8 · …" */
  if(s&&s.r&&s.r.of)return{ok:true,info:s.r.ok+'/'+s.r.of+' to‘g‘ri'};
  if(s&&s.w&&Object.values(s.w.t||{}).some(x=>typeof x==='string'&&x.trim().split(/\s+/).length>=30))return{ok:true,info:'javob yozildi'};
  if(s&&s.v)return{ok:true};
  return{ok:false,msg:'Avval mashqni bajaring: javoblarni tekshiring, keyin “Bajardim”ni bosing'}}

/* ---------- certificate (PNG to keep or share) ---------- */
async function certificate(p,t){
  const s=p.student,st=bstats(p.booster);
  const W=2000,H=1414,cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
  try{await document.fonts.load('800 80px Onest');await document.fonts.load('500 40px Onest')}catch(e){}
  const F=(w,sz)=>`${w} ${sz}px Onest, system-ui, sans-serif`;
  x.fillStyle='#fff';x.fillRect(0,0,W,H);
  x.fillStyle='#141B2D';x.fillRect(0,0,W,26);x.fillRect(0,H-26,W,26);
  x.fillStyle='#E3101F';x.fillRect(0,26,W,10);x.fillRect(0,H-36,W,10);
  x.strokeStyle='#DCE1EA';x.lineWidth=3;x.strokeRect(70,90,W-140,H-180);
  const logo=new Image();logo.src=LOGO;await new Promise(r=>{logo.onload=r;logo.onerror=r});
  try{x.drawImage(logo,W/2-70,150,140,140)}catch(e){}
  x.textAlign='center';x.fillStyle='#E3101F';x.font=F(800,40);x.fillText(G3?'EDUNEST ACADEMY · GENERAL ENGLISH · LEVEL 3':'EDUNEST ACADEMY · MULTI-LEVEL',W/2,350);
  x.fillStyle='#141B2D';x.font=F(800,150);x.fillText('SERTIFIKAT',W/2,510);
  x.fillStyle='#5A6378';x.font=F(500,44);x.fillText('Ushbu sertifikat',W/2,610);
  let nm=s.name,sz=120;x.font=F(800,sz);while(x.measureText(nm).width>W-360&&sz>60){sz-=6;x.font=F(800,sz)}
  x.fillStyle='#141B2D';x.fillText(nm,W/2,750);
  x.fillStyle='#E3101F';x.fillRect(W/2-260,785,520,6);
  x.fillStyle='#5A6378';x.font=F(500,44);x.fillText('ga',W/2,860);
  x.fillStyle='#141B2D';x.font=F(800,58);x.fillText(`“${t.title}”`,W/2,950);
  const ex=!t.booster&&t.total===1&&isExam(t.steps[0].l);const inf=ex?(resText(examRes(t.steps[0].l))||t.steps[0].info||''):'';const ip=inf.split(' · ');
  x.fillStyle='#5A6378';x.font=F(500,44);x.fillText(ex?'sinov imtihonini to‘liq topshirgani uchun beriladi.':'dasturini to‘liq tugatgani uchun beriladi.',W/2,1020);
  const stats=t.booster?[`${BOOSTER_TESTS} test`,`O‘qish aniqligi ${st.acc||0}%`,`${t.steps.reduce((a,b)=>a+(b.xp||0),0)} XP`]:ex&&ip.length===3?[`To‘g‘ri javoblar: ${ip[0]}`,ip[1],/^[ABC]\d$/.test(ip[2])?ip[2]+' daraja':ip[2]]:[`${t.total} bosqich`,`${t.total*t.xpEach} XP`];
  x.fillStyle='#141B2D';x.font=F(700,40);x.fillText(stats.join('   ·   '),W/2,1105);
  x.textAlign='left';x.fillStyle='#141B2D';x.font=F(800,44);x.fillText("A'zamjon Toxirov",150,1250);
  x.fillStyle='#5A6378';x.font=F(500,34);x.fillText('C1 o‘qituvchi, EDUNEST Academy',150,1298);
  x.strokeStyle='#141B2D';x.lineWidth=3;x.beginPath();x.moveTo(150,1195);x.lineTo(620,1195);x.stroke();
  x.textAlign='right';x.fillStyle='#5A6378';x.font=F(500,34);x.fillText('Sertifikat raqami',W-150,1250);
  x.fillStyle='#141B2D';x.font=F(800,44);x.fillText(`EDN-${s.id}-${t.aid==='booster'?'RB30':t.aid.slice(-4).toUpperCase()}`,W-150,1298);
  const url=cv.toDataURL('image/png');
  modal(`<h3>Tabriklaymiz!</h3><p class="muted" style="margin-top:4px">Sertifikatingiz tayyor. Uni yuklab oling yoki do‘stlaringizga ulashing.</p><img class="certimg" src="${url}" alt="Sertifikat">`,
    [{t:'Yopish'},{t:'Yuklab olish',cls:'red',f:()=>{const a=document.createElement('a');a.href=url;a.download=`EDUNEST-sertifikat-${s.id}.png`;document.body.appendChild(a);a.click();a.remove()}}]);
  confetti();
}

/* ================= TEACHER ================= */
async function loadT(force){
  if(TD&&!force)return TD;
  const j=await cget({action:'tlist',key:U.pass},25000);
  if(j&&!j.ok&&/key/.test(j.error||'')){logout(true);toast('Parol o‘zgargan. Qaytadan kiring.');throw new Error('auth')}
  if(!j||!j.ok)throw new Error(j&&j.error||'error');
  j.roster=j.roster.filter(r=>r.type==='guest'?!G3:mineG(r.group));j.assignments=j.assignments.filter(mineA).filter(a=>!isSoon(a));
  keepKey(j.k);TD=j;return TD;
}
const xpOf=id=>((TD.xp||{})[id])||{B:0,bn:0,A:0,an:0,G:0,T:0};
const actT=id=>((TD.act||{})[id])||{cur:0,best:0,total:0,d7:0,last:0,today:false};
const rsT=id=>((TD.rs||{})[id])||{n:0,acc:null,last:0};
const forGroup=(a,g)=>a.groups.toUpperCase()==='ALL'||a.groups.toUpperCase().split(/[,\s]+/).includes(String(g).toUpperCase());
function groupRank(group){
  const rows=TD.roster.filter(s=>s.group===group).map(s=>({s,o:xpOf(s.id)}));
  rows.sort((a,b)=>b.o.T-a.o.T||a.s.name.localeCompare(b.s.name));
  rows.forEach((r,i)=>{r.r=i&&rows[i-1].o.T===r.o.T?rows[i-1].r:i+1});return rows;
}
function tRows(){
  const as=TD.assignments.filter(a=>!a.hidden);const rk={};
  [...new Set(TD.roster.map(s=>s.group))].forEach(g=>groupRank(g).forEach(r=>rk[r.s.id]=r.r));
  return TD.roster.map(s=>{const b=TD.booster[s.id]||{};const pr=TD.progress[s.id]||{};
    const mine=as.filter(a=>forGroup(a,s.group));const stot=mine.reduce((n,a)=>n+a.steps.length,0);
    const sdone=mine.reduce((n,a)=>n+a.steps.filter((_,i)=>pr[a.aid+':'+i]==='done').length,0);
    const ac=actT(s.id),rs=rsT(s.id);
    return{s,done:+b.done||0,last:Math.max(b.last||0,ac.last||0,rs.last||0),sdone,stot,xp:xpOf(s.id).T,rank:rk[s.id],ac,rs}});
}
const TTABS=[['students','O‘quvchilar'],['act','Faollik'],['assign','Topshiriqlar'],['league','Reyting'],...(G3?[]:[['ai','AI Writing'],['guests','Mehmonlar']]),['settings','Sozlamalar']];
async function teacherHome(tab){
  document.body.classList.remove('st-mode');
  tab=TTABS.some(t=>t[0]===tab)?tab:'students';ui.ttab=tab;setBack(null);
  if(!TD)view().innerHTML='<div class="wrap"><div class="loading" style="margin-top:60px"><div class="spin"></div>Yuklanmoqda…</div></div>';
  try{await loadT()}catch(e){view().innerHTML=`<div class="wrap"><div class="card sec"><h3>Ma’lumot yuklanmadi</h3><p class="muted">${esc(e.message)}</p><button class="btn red big" onclick="TD=null;route()">Qayta urinish</button></div></div>`;return}
  const rows=tRows();const st=rows.filter(r=>r.s.type!=='guest'),gu=rows.filter(r=>r.s.type==='guest');
  const week=Date.now()-7*864e5;
  view().innerHTML=`<div class="wrap anim tab-${tab}">
    <h1 class="pgh">Ustoz paneli</h1>
    <div class="kpis">
      <div class="card kpi"><div class="l">O‘quvchilar</div><div class="v">${st.length}</div><div class="muted ks">${tGroups().map(g=>g+' '+st.filter(r=>r.s.group===g).length).join(', ')}</div></div>
      <div class="card kpi ${G3?'hide':''}"><div class="l">Mehmonlar</div><div class="v">${gu.length}</div><div class="muted ks">${gu.filter(r=>r.s.joined&&new Date(r.s.joined).getTime()>week).length} ta shu hafta</div></div>
      <div class="card kpi"><div class="l">Bugun kirganlar</div><div class="v">${st.filter(r=>r.ac.today).length}</div><div class="muted ks">shu hafta ${st.filter(r=>r.ac.d7>0).length} o‘quvchi</div></div>
      <div class="card kpi"><div class="l">Jami XP</div><div class="v">${rows.reduce((s,r)=>s+r.xp,0)}</div><div class="muted ks">hamma o‘quvchilar</div></div>
    </div>
    <div class="ttabs">${TTABS.map(([k,l])=>`<button class="${tab===k?'on':''}" data-t="${k}">${l}${k==='guests'?` <b>${gu.length}</b>`:k==='assign'?` <b>${TD.assignments.filter(a=>!a.hidden).length+(G3?0:1)}</b>`:''}</button>`).join('')}
      <div style="flex:1"></div><button class="btn ghost" id="tRef">Yangilash</button></div>
    <div id="tBody"></div></div>`;
  document.querySelectorAll('.ttabs [data-t]').forEach(b=>b.onclick=()=>go('#/teacher/'+b.dataset.t));
  $('#tRef').onclick=()=>{TD=null;teacherHome(tab)};
  if(tab==='assign')tAssign();else if(tab==='league')tLeague();else if(tab==='settings')tSettings();else if(tab==='ai')tAI();else if(tab==='act')tAct();else tList(tab==='guests'?gu:st,tab==='guests');
}
/* ---------- AI Writing (Gemini): settings + every check students made ---------- */
const AI_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
const AI_TN={'1.1':'Task 1.1 · norasmiy xat','1.2':'Task 1.2 · rasmiy xat','2':'Part 2 · esse','S1.1':'Speaking 1.1 · suhbat','S1.2':'Speaking 1.2 · taqqoslash','S2':'Speaking 2 · monolog','S3':'Speaking 3 · munozara'};
const AI_CN=[['task','Topshiriq'],['fluency','Ravonlik'],['grammar','Grammatika'],['vocabulary','Lug‘at'],['organisation','Bog‘lanish'],['mechanics','Imlo'],['pronunciation','Talaffuz']];
const aiLvC=l=>l==='C1'?'#159947':l==='B2'?'#2F80ED':l==='B1'?'#D98A06':'#E3101F';
function aiDetail(c){const r=c.r||{},all=r.mistakes||[],er=all.filter(m=>m.kind!=='tip'),tp=all.filter(m=>m.kind==='tip');
  const mi=(m,i)=>`<div class="aimi"><b>${i+1}.</b> <del>${esc(m.original)}</del> → <ins>${esc(m.correction)}</ins><small>${esc(m.explain_uz)}</small></div>`;
  return `<div class="aidet">${c.task?`<div class="aiblk"><h4>Topshiriq</h4><p class="pre">${esc(c.task)}</p></div>`:''}
    <div class="aiblk"><h4>${/^S/.test(c.type)?'Aytgani (AI transkripti)':'O‘quvchi matni'} · ${c.words} so‘z</h4><p class="pre">${esc(c.text)}</p></div>
    <div class="aiblk"><h4>Ballar</h4><div class="aisc">${AI_CN.filter(([k])=>k in (r.scores||{})).map(([k,n])=>`<span><b>${r.scores[k]}/10</b>${n}</span>`).join('')}<span><b>${r.max?r.points+'/'+r.max:r.kind==='speaking'?r.pct+'%':c.score+'/75'}</b>${esc(c.level)}</span></div><p>${esc(r.summary_uz||'')}</p>${r.word_note_uz?`<p>⚠️ ${esc(r.word_note_uz)}</p>`:''}</div>
    <div class="aiblk"><h4>Xatolar (${er.length})</h4>${er.length?er.map(mi).join(''):'<p>Xato topilmadi.</p>'}</div>
    ${tp.length?`<div class="aiblk"><h4>Tavsiyalar (${tp.length}) — xato emas</h4>${tp.map(mi).join('')}</div>`:''}
    ${r.improved?`<div class="aiblk"><h4>AI yaxshilagan variant</h4><p class="pre">${esc(r.improved)}</p></div>`:''}</div>`}
async function tAI(){
  const B=$('#tBody');B.innerHTML='<div class="loading" style="margin-top:30px"><div class="spin"></div>Yuklanmoqda…</div>';
  let j=null;try{j=await cget({action:'ailist',key:U.pass},30000)}catch(e){}
  if(!j||!j.ok){B.innerHTML='<div class="card sec"><h3>Yuklanmadi</h3><p class="muted">Google skript yangilanganini tekshiring (yangi versiya), so‘ng “Yangilash”ni bosing.</p></div>';return}
  const A=j.ai,C=j.checks||[];const F=ui.aif=ui.aif||{q:'',t:''};if(ui.aiq){F.q=ui.aiq;ui.aiq=''}
  const week=Date.now()-7*864e5,wk=C.filter(c=>c.at>week),avg=C.length?Math.round(C.reduce((s,c)=>s+c.score,0)/C.length):0;
  B.innerHTML=`<div class="card sec aiset"><h3>${AI_SVG} AI Writing tekshiruvi <small>Google Gemini · bepul</small></h3>
      <p class="aist ${A.on?'on':''}">${A.on?'Yoqilgan — o‘quvchilar Writing sahifalarida va «AI Writing yordamchi»da tekshira oladi':A.hasKey?'O‘chirilgan — o‘quvchilar hozir tekshira olmaydi':'Hali ulanmagan — Gemini kalitini qo‘ying'}</p>
      ${A.hasKey?'':`<ol class="aisteps"><li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"><b>aistudio.google.com/apikey</b></a> sahifasini oching va Google akkauntingiz bilan kiring.</li><li><b>Create API key</b> tugmasini bosing, kalitni nusxa oling.</li><li>Kalitni pastdagi qatorga qo‘yib, <b>Ulash</b>ni bosing. Kalit faqat sizning Google skriptingizda saqlanadi.</li></ol>`}
      <div class="setrow"><input id="aiKey" type="password" autocomplete="off" placeholder="${A.hasKey?'Yangi kalit (almashtirish uchun)':'AIza…'}"><button class="btn red" id="aiKeySave">${A.hasKey?'Almashtirish':'Ulash'}</button></div>
      ${A.hasKey?`<div class="setrow airow2"><label for="aiLim">Kunlik limit, 1 o‘quvchiga</label><input id="aiLim" type="number" inputmode="numeric" min="0" max="50" value="${A.limit}"><button class="btn ghost" id="aiLimSave">Saqlash</button><button class="btn ${A.on?'ghost':'navy'}" id="aiOn">${A.on?'O‘chirish':'Yoqish'}</button></div>
      <p class="muted aihint">0 = cheksiz. Bepul Google limiti butun sayt uchun umumiy: juda ko‘p o‘quvchi bir vaqtda tekshirsa, ularga «biroz kuting» chiqadi. Bepul tarifda Google yuborilgan matnlardan o‘z mahsulotlarini yaxshilash uchun foydalanishi mumkin; o‘quvchi ismi va ID yuborilmaydi.</p>`:''}</div>
    <div class="kpis"><div class="card kpi"><div class="l">Jami tekshiruv</div><div class="v">${C.length}</div><div class="muted ks">oxirgi 300 tasi</div></div>
      <div class="card kpi"><div class="l">Shu hafta</div><div class="v">${wk.length}</div><div class="muted ks">${new Set(wk.map(c=>c.id)).size} o‘quvchi</div></div>
      <div class="card kpi"><div class="l">O‘rtacha ball</div><div class="v">${avg}</div><div class="muted ks">75 dan, taxminiy</div></div>
      <div class="card kpi"><div class="l">Foydalanganlar</div><div class="v">${new Set(C.map(c=>c.id)).size}</div><div class="muted ks">o‘quvchi</div></div></div>
    <div class="tfil"><input id="aiQ" placeholder="Ism yoki ID" value="${esc(F.q)}" aria-label="Qidirish"><select id="aiT" aria-label="Topshiriq turi"><option value="">Barcha turlar</option>${['1.1','1.2','2','S1.1','S1.2','S2','S3'].map(k=>`<option value="${k}" ${F.t===k?'selected':''}>${AI_TN[k]}</option>`).join('')}</select></div>
    <div id="aiList" class="ailist"></div>`;
  const draw=()=>{const q=F.q.toLowerCase();const L=C.filter(c=>(!F.t||c.type===F.t)&&(!q||(c.name+' '+c.id).toLowerCase().includes(q)));
    $('#aiList').innerHTML=L.length?L.map(c=>{const i=C.indexOf(c);return `<div class="card aichk"><button class="aihd" data-ai="${i}" aria-expanded="false">
        <span class="ailv" style="background:${aiLvC(c.level)}">${esc(c.level==='B1 dan past'?'B1−':c.level)}<small>${c.r&&c.r.max?c.r.points+'/'+c.r.max:c.r&&c.r.kind==='speaking'?c.r.pct+'%':c.score}</small></span>
        <span class="aitx"><b>${esc(c.name)}</b><small>${esc(c.group)} · ${AI_TN[c.type]||esc(c.type)} · ${c.words} so‘z · ${new Date(c.at).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</small></span>
        <span class="aiar">›</span></button><div class="aibody" hidden></div></div>`}).join(''):'<p class="muted empty">Hali tekshiruvlar yo‘q.</p>';
    document.querySelectorAll('[data-ai]').forEach(b=>b.onclick=()=>{const bd=b.nextElementSibling,open=bd.hidden;if(open&&!bd.innerHTML)bd.innerHTML=aiDetail(C[+b.dataset.ai]);bd.hidden=!open;b.setAttribute('aria-expanded',open)})};
  $('#aiQ').oninput=e=>{F.q=e.target.value;draw()};$('#aiT').onchange=e=>{F.t=e.target.value;draw()};draw();
  const save=async(body,ok)=>{try{const x=await cpost(Object.assign({action:'setAi',key:U.pass},body));if(!x.ok)throw x;toast(x.warn==='busy'?'Kalit saqlandi. Google hozir band — birozdan keyin sinab ko‘ring.':ok);tAI()}
    catch(e){toast(e&&e.error==='badkey'?'Google bu kalitni qabul qilmadi. Kalitni tekshiring.':'Saqlanmadi. Skript yangilanganini tekshiring.');const kb=$('#aiKeySave');if(kb){kb.disabled=false;kb.textContent=A.hasKey?'Almashtirish':'Ulash'}}};
  $('#aiKeySave').onclick=()=>{const k=$('#aiKey').value.trim();if(!/^\S{20,}$/.test(k)){toast('Kalit noto‘g‘ri ko‘rinishda');return}$('#aiKeySave').disabled=true;$('#aiKeySave').textContent='Tekshirilmoqda…';save({aikey:k},'AI ulandi va yoqildi ✓')};
  if($('#aiLimSave'))$('#aiLimSave').onclick=()=>save({limit:+$('#aiLim').value||0},'Limit saqlandi');
  if($('#aiOn'))$('#aiOn').onclick=()=>save({on:!A.on},A.on?'AI o‘chirildi':'AI yoqildi');
}
/* ---------- students: groups, new students, edit, move, remove ---------- */
const tGroups=()=>{const s=new Set(GROUPS.filter(g=>g!=='GUEST'));(TD?TD.roster:[]).forEach(r=>{if(r.type!=='guest'&&r.group&&mineG(r.group))s.add(String(r.group))});return [...s]};
const isNewS=s=>!!s.joined&&Date.now()-new Date(s.joined).getTime()<14*864e5;
const normG=g=>String(g||'').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);
function tList(rows,guests){
  ui.tf=ui.tf||{q:'',g:'ALL',sort:'xp'};const f=ui.tf;if(guests)f.g='ALL';
  if(f.g!=='ALL'&&f.g!=='NEW'&&f.g!=='NOPIN'&&!tGroups().includes(f.g))f.g='ALL';
  const sel=ui.sel=ui.sel instanceof Set?ui.sel:new Set();[...sel].forEach(id=>{if(!rows.some(x=>x.s.id===id))sel.delete(id)});
  const pass=x=>f.g==='ALL'||(f.g==='NEW'?isNewS(x.s):f.g==='NOPIN'?(!x.s.hasPin&&!x.s.tg):x.s.group===f.g);
  const chips=()=>guests?'':[['ALL','Barchasi',rows.length,''],...tGroups().map(g=>[g,g,rows.filter(x=>x.s.group===g).length,'']),
      ['NEW','Yangi (14 kun)',rows.filter(x=>isNewS(x.s)).length,'new'],['NOPIN','Hali kirmagan',rows.filter(x=>!x.s.hasPin&&!x.s.tg).length,'warn']]
    .map(([k,l,n,c])=>`<button class="rs-chip ${c} ${f.g===k?'on':''}" data-fg="${esc(k)}">${esc(l)} <b>${n}</b></button>`).join('');
  const bulk=()=>{const n=sel.size,box=$('#rsBulk');if(!box)return;if(!n){box.innerHTML='';box.hidden=true;return}box.hidden=false;
    box.innerHTML=`<b>${n} ta tanlandi</b><select id="rsTo" aria-label="Qaysi guruhga">${tGroups().map(g=>`<option>${esc(g)}</option>`).join('')}<option value="+">+ Yangi guruh…</option></select>
      <button class="btn red" id="rsMove">Ko‘chirish</button><button class="btn ghost" id="rsDel" style="color:#fff">O‘chirish</button><button class="btn ghost" id="rsClr" style="color:#fff">Bekor</button>`;
    $('#rsClr').onclick=()=>{sel.clear();draw()};
    $('#rsMove').onclick=async()=>{let g=$('#rsTo').value;if(g==='+'){g=normG(prompt('Yangi guruh nomi (lotin harflari, masalan: TIGERS)')||'');if(!g)return}
      if(G3&&!SITE_GROUPS.includes(g)){toast('Bu saytda faqat DOLPHINS va PENGUINS');return false}
      const b=$('#rsMove');b.disabled=true;b.textContent='Saqlanmoqda…';
      try{const j=await cpost({action:'importRoster',key:U.pass,rows:[...sel].map(id=>[id,'',g,''])});if(!j.ok)throw 0;toast(`${sel.size} ta o‘quvchi ${g} guruhiga o‘tkazildi`);sel.clear();ui.tf.g=g;TD=null;teacherHome('students')}
      catch(e){toast('Saqlanmadi');b.disabled=false;b.textContent='Ko‘chirish'}};
    $('#rsDel').onclick=()=>{const ids=[...sel];modal(`<h3>${ids.length} ta o‘quvchini o‘chirasizmi?</h3><p class="muted" style="margin-top:6px">Ular ro‘yxatdan butunlay o‘chadi va saytga kira olmaydi. Buni qaytarib bo‘lmaydi (kerak bo‘lsa qaytadan qo‘shasiz).</p>`,
      [{t:'Bekor qilish'},{t:'Ha, o‘chirish',cls:'red',f:async()=>{toast('O‘chirilmoqda…');let n=0;for(const id of ids){try{const j=await cpost({action:'editStudent',key:U.pass,id,remove:true});if(j.ok)n++}catch(e){}}
        toast(`${n} ta o‘quvchi o‘chirildi`);sel.clear();TD=null;teacherHome(guests?'guests':'students')}}])}};
  const draw=()=>{
    let r=rows.filter(x=>pass(x)&&(!f.q||(x.s.name+' '+x.s.id+' '+x.s.phone).toLowerCase().includes(f.q.toLowerCase())));
    r.sort(f.sort==='done'?(a,b)=>b.done-a.done:f.sort==='last'?(a,b)=>b.last-a.last:f.sort==='act'?(a,b)=>b.ac.d7-a.ac.d7||b.ac.cur-a.ac.cur||b.last-a.last:f.sort==='acc'?(a,b)=>(b.rs.acc==null?-1:b.rs.acc)-(a.rs.acc==null?-1:a.rs.acc):f.sort==='lazy'?(a,b)=>(a.last||0)-(b.last||0):f.sort==='name'?(a,b)=>a.s.name.localeCompare(b.s.name):f.sort==='new'?(a,b)=>new Date(b.s.joined||0)-new Date(a.s.joined||0):(a,b)=>b.xp-a.xp||a.s.name.localeCompare(b.s.name));
    if($('#rsChips'))$('#rsChips').innerHTML=chips();
    $('#tTbl').innerHTML=r.length?`<label class="muted" style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:14px;margin:0 0 6px 16px"><input type="checkbox" class="rs-ck" id="rsAll" ${r.every(x=>sel.has(x.s.id))?'checked':''}> Hammasini tanlash (${r.length})</label>`+r.map(x=>`<div class="card srow rsrow${guests?'':' wact'}">
      <input type="checkbox" class="rs-ck" data-ck="${esc(x.s.id)}" ${sel.has(x.s.id)?'checked':''} aria-label="${esc(x.s.name)} ni tanlash">
      <div class="sav avw">${avHTML((TD.av||{})[x.s.id],x.s.name,lvIdx(x.xp),'sm')}</div>
      <div class="sn"><b>${esc(x.s.name)}${isNewS(x.s)?'<span class="rs-new">YANGI</span>':''}</b><small>${guests?(x.s.joined?'kelgan: '+new Date(x.s.joined).toLocaleDateString('en-GB'):'mehmon'):`ID ${esc(x.s.id)}, ${esc(x.s.group)}, ${x.s.hasPin?'parol bor':x.s.tg?'Telegram':'<span class="nopin">hali kirmagan</span>'}${x.s.tgu?', '+esc(x.s.tgu):x.s.tg?', Telegram ✓':''}`}</small></div>
      <div class="sp2"><b>${x.xp} XP</b><small>${x.rank?x.rank+'-o‘rin':''}</small></div>
      <div class="sp2 ${G3?'hide':''}"><b>${x.done}/${BOOSTER_TESTS}</b><div class="minibar"><b style="width:${x.done/BOOSTER_TESTS*100}%"></b></div><small>Booster</small></div>
      <div class="sp2"><b>${x.sdone}/${x.stot}</b><small>bosqichlar</small></div>
      ${guests?'':`<div class="sp2 sact"><b><span class="${x.ac.today?'tdy':''}" title="ketma-ket kunlar">🔥 ${x.ac.cur}</span> · ${x.ac.d7}/7 kun</b><small>${x.ac.last?esc(agoUz(x.ac.last)):'hali kirmagan'}${x.rs.n?` · <span class="pc ${pcCls(x.rs.acc)}">${x.rs.acc}%</span> (${x.rs.n})`:''}</small></div>`}
      <div class="sbtns">${x.s.phone&&x.s.phone.length===9?`<a class="btn ghost call" href="${tel(x.s.phone)}" aria-label="Qo‘ng‘iroq ${phoneNice(x.s.phone)}">📞<span>${phoneNice(x.s.phone)}</span></a>`:''}<button class="btn ghost" data-ed="${esc(x.s.id)}" aria-label="${esc(x.s.name)}: tahrirlash">✎</button><button class="btn navy" data-s="${esc(x.s.id)}">Profil</button></div>
    </div>`).join(''):'<p class="muted empty">Bu yerda hali hech kim yo‘q.</p>';
    document.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>go('#/teacher/s/'+encodeURIComponent(b.dataset.s)));
    document.querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>editStudentBox(TD.roster.find(s=>s.id===b.dataset.ed)));
    document.querySelectorAll('[data-ck]').forEach(c=>c.onchange=()=>{c.checked?sel.add(c.dataset.ck):sel.delete(c.dataset.ck);bulk();const a=$('#rsAll');if(a)a.checked=r.every(x=>sel.has(x.s.id))});
    const a=$('#rsAll');if(a)a.onchange=()=>{r.forEach(x=>a.checked?sel.add(x.s.id):sel.delete(x.s.id));draw()};
    document.querySelectorAll('[data-fg]').forEach(b=>b.onclick=()=>{f.g=b.dataset.fg;draw()});
    bulk();
  };
  $('#tBody').innerHTML=`${guests?'':'<div class="rs-chips" id="rsChips"></div>'}<div class="tfil">
    <input id="tQ" placeholder="Ism, ID yoki telefon" value="${esc(f.q)}" aria-label="Qidirish">
    <select id="tS" aria-label="Tartib"><option value="xp">XP bo‘yicha</option><option value="name" ${f.sort==='name'?'selected':''}>Ism bo‘yicha</option><option value="new" ${f.sort==='new'?'selected':''}>Yangi qo‘shilganlar</option><option value="done" ${f.sort==='done'?'selected':''}>Booster bo‘yicha</option><option value="last" ${f.sort==='last'?'selected':''}>Oxirgi faollik</option><option value="act" ${f.sort==='act'?'selected':''}>Eng faollar (7 kun)</option><option value="acc" ${f.sort==='acc'?'selected':''}>O‘rtacha natija</option><option value="lazy" ${f.sort==='lazy'?'selected':''}>Uzoq kirmaganlar</option></select>
    ${guests?'':'<button class="btn red" id="tImp">+ O‘quvchi qo‘shish</button>'}
  </div><div id="tTbl" class="slist"></div><div class="rs-bulk" id="rsBulk" hidden></div>`;
  $('#tQ').oninput=e=>{f.q=e.target.value;draw()};$('#tS').onchange=e=>{f.sort=e.target.value;draw()};
  if($('#tImp'))$('#tImp').onclick=()=>addStudentBox();
  draw();
}
function grpSelect(id,cur){const gs=tGroups();if(cur&&!gs.includes(cur))gs.push(cur);
  return `<select id="${id}">${gs.map(g=>`<option ${g===cur?'selected':''}>${esc(g)}</option>`).join('')}${G3?'':'<option value="+">+ Yangi guruh…</option>'}</select><input id="${id}N" placeholder="Yangi guruh nomi, masalan: TIGERS" hidden style="margin-top:8px">`}
function bindGrp(id,F){const s=$('#'+id),n=$('#'+id+'N');F.group=s.value;s.onchange=()=>{n.hidden=s.value!=='+';F.group=s.value==='+'?normG(n.value):s.value;if(!n.hidden)n.focus()};n.oninput=()=>{n.value=n.value.toUpperCase();F.group=normG(n.value)}}
function editStudentBox(s){if(!s)return;const guest=s.type==='guest';const F={name:s.name,phone:s.phone||'',group:s.group};
  modal(`<h3>O‘quvchini tahrirlash</h3><p class="muted" style="margin-top:4px">${guest?'Mehmon':'ID '+esc(s.id)}${isNewS(s)?' · yangi qo‘shilgan':''}</p>
    <div class="rs-form"><div><label for="esN">Ism familiya</label><input id="esN" value="${esc(s.name)}" autocomplete="off"></div>
      <div class="rs-row2">${guest?'':`<div><label for="esG">Guruh</label>${grpSelect('esG',s.group)}</div>`}<div><label for="esP">Telefon (9 raqam)</label><input id="esP" inputmode="numeric" value="${esc(s.phone||'')}" placeholder="901234567"></div></div></div>
    <div class="rs-danger"><p>${guest?'Mehmonni':'O‘quvchini'} ro‘yxatdan butunlay o‘chirish</p><button class="btn ghost" id="esDel" style="color:var(--red)">O‘chirish</button></div>`,
    [{t:'Bekor qilish'},{t:'Saqlash',cls:'red',keep:1,f:async()=>{const name=cleanName(F.name).trim(),phone=F.phone.replace(/\D/g,'').slice(-9);
      if(name.split(' ').filter(Boolean).length<2){toast('Ism va familiyani yozing');return false}
      if(!guest&&!F.group){toast('Guruh nomini yozing');return false}
      if(phone&&phone.length!==9){toast('Telefon 9 ta raqam bo‘lsin');return false}
      const body={action:'editStudent',key:U.pass,id:s.id,name,phone};if(!guest)body.group=F.group;
      try{const j=await cpost(body);if(!j.ok)throw 0;toast('Saqlandi');TD=null;route()}catch(e){toast('Saqlanmadi')}}}]);
  $('#esN').oninput=e=>F.name=e.target.value;$('#esP').oninput=e=>F.phone=e.target.value;if(!guest)bindGrp('esG',F);
  $('#esDel').onclick=()=>modal(`<h3>${esc(s.name)} ni o‘chirasizmi?</h3><p class="muted" style="margin-top:6px">U ro‘yxatdan o‘chadi va saytga kira olmaydi. Buni qaytarib bo‘lmaydi (kerak bo‘lsa qaytadan qo‘shasiz).</p>`,
    [{t:'Bekor qilish'},{t:'Ha, o‘chirish',cls:'red',f:async()=>{try{const j=await cpost({action:'editStudent',key:U.pass,id:s.id,remove:true});if(!j.ok)throw 0;toast('O‘chirildi');TD=null;
      if(location.hash.startsWith('#/teacher/s/'))go('#/teacher/'+(guest?'guests':'students'),true);else route()}catch(e){toast('Xatolik')}}}]);
}
function nextId(){const n=TD.roster.map(s=>+s.id).filter(x=>x>0&&x<1e7);return n.length?String(Math.max(...n)+1):''}
function parseRoster(txt){
  return txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.match(/^(\S*?\d{3,}\S*)[\s,;|\t]+(.*)$/)||l.match(/^(\S*?\d{3,}\S*)$/);if(!m)return null;
    const name=cleanName((m[2]||'').replace(/[\t|;]+/g,' ').replace(/\+?\d[\d\s-]{8,}$/,'')).trim();return{id:m[1].replace(/[^\w-]/g,''),name}}).filter(Boolean);
}
function addStudentBox(mode){mode=mode||'one';const F={id:nextId(),name:'',phone:'',group:ui.tf&&tGroups().includes(ui.tf.g)?ui.tf.g:tGroups()[0]};
  const known=new Set(TD.roster.map(s=>s.id));
  modal(`<h3>O‘quvchi qo‘shish</h3>
    <div class="seg rs-tabs"><button class="${mode==='one'?'on':''}" id="adOne">Bitta</button><button class="${mode==='list'?'on':''}" id="adList">Ro‘yxat bilan</button></div>
    ${mode==='one'?`<div class="rs-form">
      <div class="rs-row2"><div><label for="adI">ID raqam</label><input id="adI" inputmode="numeric" value="${esc(F.id)}"></div><div><label for="adG">Guruh</label>${grpSelect('adG',F.group)}</div></div>
      <div><label for="adN">Ism familiya</label><input id="adN" placeholder="Ali Valiyev" autocomplete="off"></div>
      <div><label for="adP">Telefon (ixtiyoriy, 9 raqam)</label><input id="adP" inputmode="numeric" placeholder="901234567"></div>
      <p class="muted" style="margin:0;font-size:14px">O‘quvchi birinchi kirishda shu ID bilan o‘ziga parol o‘ylab topadi.</p></div>`
    :`<p class="muted" style="margin:6px 0 10px">Har bir qatorda: ID va to‘liq ism familiya. Ro‘yxatda bor o‘quvchilar o‘zgarmaydi, faqat yangilari qo‘shiladi.</p>
      <div class="rs-form" style="margin-bottom:10px"><div><label for="adG">Guruh</label>${grpSelect('adG',F.group)}</div></div>
      <textarea id="impT" class="imptxt" rows="7" placeholder="63050 Ali Valiyev&#10;63051 Vali Aliyev"></textarea>
      <p class="muted" id="impInfo" style="font-size:14px;margin:8px 0 0"></p>`}`,
    [{t:'Bekor qilish'},{t:'Qo‘shish',cls:'red',keep:1,f:async()=>{const g=F.group;if(!g){toast('Guruh nomini yozing');return false}
      if(G3&&!SITE_GROUPS.includes(g)){toast('Bu saytda faqat DOLPHINS va PENGUINS');return false}
      let rows;
      if(mode==='one'){const id=F.id.trim().replace(/[^\w-]/g,''),name=cleanName(F.name).trim(),ph=F.phone.replace(/\D/g,'').slice(-9);
        if(!id){toast('ID yozing');return false}if(known.has(id)){toast('Bu ID allaqachon bor');return false}
        if(name.split(' ').filter(Boolean).length<2){toast('Ism va familiyani yozing');return false}if(ph&&ph.length!==9){toast('Telefon 9 ta raqam bo‘lsin');return false}
        rows=[[id,name,g,ph]]}
      else{const rr=F.rows||[];if(!rr.length){toast('Ro‘yxat bo‘sh');return false}const bad=rr.filter(r=>!r.name&&!known.has(r.id));if(bad.length){toast(`${bad.length} ta yangi ID uchun ism yo‘q`);return false}
        rows=rr.map(r=>[r.id,r.name,known.has(r.id)?'':g,''])}
      try{const j=await cpost({action:'importRoster',key:U.pass,rows});if(!j.ok)throw 0;toast(mode==='one'?'O‘quvchi qo‘shildi ✓':`Qo‘shildi: ${j.added}, yangilandi: ${j.updated}`);ui.tf=Object.assign(ui.tf||{},{g:'NEW',sort:'new'});TD=null;teacherHome('students')}catch(e){toast('Saqlanmadi')}}}]);
  $('#adOne').onclick=()=>addStudentBox('one');$('#adList').onclick=()=>addStudentBox('list');bindGrp('adG',F);
  if(mode==='one'){$('#adI').oninput=e=>F.id=e.target.value;$('#adN').oninput=e=>F.name=e.target.value;$('#adP').oninput=e=>F.phone=e.target.value;$('#adN').focus()}
  else{const t=$('#impT');t.oninput=()=>{F.rows=parseRoster(t.value);const nw=F.rows.filter(r=>!known.has(r.id)).length;
    $('#impInfo').textContent=F.rows.length?`${F.rows.length} ta qator: ${nw} ta yangi, ${F.rows.length-nw} ta bor`:''};t.focus()}
}
function tSettings(){
  $('#tBody').innerHTML=`<div class="setg">
    <div class="card sec"><h3>Mehmon kodi</h3>
      <p class="muted">Yangi kelgan o‘quvchilarga darsda ayting. Kodsiz hech kim mehmon sifatida kira olmaydi. Mehmonlar 3 kun foydalanadi.</p>
      <div class="gcode">${esc(TD.guestCode||'')}</div>
      <div class="setrow"><input id="gcNew" inputmode="numeric" placeholder="Yangi kod (kamida 4 belgi)" maxlength="12"><button class="btn red" id="gcSave">Almashtirish</button></div></div>
    <div class="card sec"><h3>Ustoz paroli</h3>
      <p class="muted">Kamida 8 belgi: harf, raqam va belgi aralash bo‘lsin. Almashtirgandan keyin barcha qurilmalarda yangi parol bilan kirasiz.</p>
      <div class="setrow"><input id="tpNew" type="password" autocomplete="new-password" placeholder="Yangi parol"><input id="tpNew2" type="password" autocomplete="new-password" placeholder="Takrorlang"></div>
      <button class="btn navy" id="tpSave" style="margin-top:10px">Parolni almashtirish</button></div>
    <div class="card sec"><h3>Telegram bot</h3>
      ${TD.tgBot?`<p class="muted">Ulangan: <a href="https://t.me/${esc(TD.tgBot)}" target="_blank" rel="noopener"><b>@${esc(TD.tgBot)}</b></a>. O‘quvchilar saytga Telegram orqali kiradi; ularning Telegram raqami va @username’i ro‘yxatda ko‘rinadi.</p>
        <p><b>${TD.roster.filter(r=>r.type!=='guest'&&r.tg).length}</b> / ${TD.roster.filter(r=>r.type!=='guest').length} o‘quvchi Telegram ulagan.</p>`
      :`<p class="muted">BotFather bergan tokenni shu yerga qo‘ying. Token faqat sizning Google skriptingizda saqlanadi, saytda ko‘rinmaydi.</p>`}
      <div class="setrow"><input id="tgTok" type="password" autocomplete="off" placeholder="${TD.tgBot?'Yangi token (almashtirish uchun)':'123456789:AA…'}"><button class="btn red" id="tgSave">${TD.tgBot?'Almashtirish':'Ulash'}</button></div></div>
    <div class="card sec"><h3>O‘quvchi parollari</h3>
      <p class="muted">Har bir o‘quvchi birinchi kirishda o‘ziga 4–8 xonali parol o‘ylab topadi. Parolni unutgan o‘quvchining profilini oching va “Parolni yangilash” ni bosing: keyingi kirishda u yangi parol o‘ylab topadi.</p>
      <p><b>${TD.roster.filter(r=>r.type!=='guest'&&r.hasPin).length}</b> / ${TD.roster.filter(r=>r.type!=='guest').length} o‘quvchi parol o‘rnatgan.</p></div>
  </div>`;
  $('#tgSave').onclick=async()=>{const t=$('#tgTok').value.trim();if(!/^\d{6,12}:[\w-]{30,}$/.test(t)){toast('Token noto‘g‘ri ko‘rinishda');return}
    $('#tgSave').disabled=true;try{const j=await cpost({action:'setBotToken',key:U.pass,token:t});if(!j.ok)throw j;sstore(ST+'tgbot',null);toast('Bot ulandi: @'+j.bot);TD=null;teacherHome('settings')}
    catch(e){$('#tgSave').disabled=false;toast(e&&e.error==='token'?'Telegram bu tokenni qabul qilmadi':'Ulab bo‘lmadi. Skriptga ruxsat berilganini tekshiring.')}};
  $('#gcSave').onclick=async()=>{const c=$('#gcNew').value.trim();if(c.length<4){toast('Kamida 4 belgi');return}
    try{const j=await cpost({action:'setGuestCode',key:U.pass,code:c});if(!j.ok)throw 0;toast('Mehmon kodi almashtirildi');TD=null;teacherHome('settings')}catch(e){toast('Saqlanmadi')}};
  $('#tpSave').onclick=()=>{const a=$('#tpNew').value,b=$('#tpNew2').value;
    if(a.length<8){toast('Kamida 8 belgi');return}if(a!==b){toast('Parollar bir xil emas');return}
    modal('<h3>Parolni almashtirasizmi?</h3><p class="muted" style="margin-top:6px">Yangi parolni eslab qoling yoki xavfsiz joyga yozib qo‘ying.</p>',[{t:'Bekor qilish'},{t:'Almashtirish',cls:'red',f:async()=>{
      try{const j=await cpost({action:'setTeacherKey',key:U.pass,newKey:a});if(!j.ok)throw 0;U.pass=a;sstore(ST+'t',a);toast('Parol almashtirildi')}catch(e){toast('Saqlanmadi')}}}])};
}
function tLeague(){
  ui.lg=ui.lg||{g:GROUPS.find(g=>TD.roster.some(s=>s.group===g))||'SHARKS'};const L=ui.lg;
  const groups=GROUPS.filter(g=>TD.roster.some(s=>s.group===g));const rows=groupRank(L.g);
  $('#tBody').innerHTML=`<div class="mkbar"><div class="seg">${groups.map(g=>`<button class="${g===L.g?'on':''}" data-lg="${g}">${g==='GUEST'?'Mehmonlar':g}</button>`).join('')}</div></div>
    <div class="card lgtab"><table><thead><tr><th>O‘rin</th><th>O‘quvchi</th>${G3?'':'<th>Booster</th>'}<th>Topshiriqlar</th><th>Seriya sovg‘asi</th><th>Jami XP</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td><b>${r.r}</b></td><td><button class="lnk" data-s="${esc(r.s.id)}">${esc(r.s.name)}</button></td>${G3?'':`<td>${r.o.B}<small> / ${r.o.bn} test</small></td>`}<td>${r.o.A}<small> / ${r.o.an} bosqich</small></td><td>${r.o.G||0}<small> · eng uzun ${actT(r.s.id).best} kun</small></td><td><b>${r.o.T}</b></td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-lg]').forEach(b=>b.onclick=()=>{L.g=b.dataset.lg;tLeague()});
  document.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>go('#/teacher/s/'+encodeURIComponent(b.dataset.s)));
}
function stepRow(i,s){return `<div class="steprow" data-k="${i}"><span class="stn">${i+1}</span><input class="stT" placeholder="Bosqich nomi, masalan: Test ${i+1}" value="${esc(s.t||'')}" aria-label="Bosqich ${i+1} nomi"><input class="stL" placeholder="Havola (ixtiyoriy)" value="${esc(s.l||'')}" inputmode="url" aria-label="Bosqich ${i+1} havolasi"><button class="btn ghost stX" aria-label="Bosqichni o‘chirish">✕</button></div>`}
function tAssign(){
  const rows=tRows();
  const cnt=a=>{const who=rows.filter(x=>forGroup(a,x.s.group));const pr=id=>TD.progress[id]||{};
    const fin=who.filter(x=>a.steps.every((_,i)=>pr(x.s.id)[a.aid+':'+i]==='done')).length;
    const st=who.filter(x=>a.steps.some((_,i)=>pr(x.s.id)[a.aid+':'+i])).length;return{tot:who.length,fin,st}};
  const bRows=rows.filter(x=>x.s.type!=='guest');
  ui.steps=ui.steps||[{t:'',l:''}];
  /* a map published before 20.11.2026 may still link mashq.html#d=gr1… : the same material as grammar.html#d=gr1… */
  const sameL=(x,y)=>String(x||'').replace(/^grammar\.html#/,'mashq.html#')===String(y||'').replace(/^grammar\.html#/,'mashq.html#');
  const pub=c=>TD.assignments.find(a=>a.steps[0]&&sameL(a.steps[0].l,c.steps[0].l));
  const libHTML=G3?'':`<div class="card sec lib">
    <h3>Tayyor materiallar</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">Saytga yuklangan materiallar. “E’lon qilish”ni bossangiz, o‘quvchilar sahifasida xarita bo‘lib chiqadi. Keyin pastdagi ro‘yxatdan yashirish yoki o‘chirish mumkin.</p>
    <div class="field"><label>Kimlarga e’lon qilinsin</label><div class="gchips">${[...GROUPS.filter(g=>g!=='GUEST'),'ALL'].map(g=>`<button class="lgchip gchip ${g==='ALL'?'':'on'}" data-lg="${g}">${g==='ALL'?'Hammaga (mehmonlar ham)':g}</button>`).join('')}</div></div>
    <div class="liblist">${LIB.map((c,i)=>{const a=pub(c),cv=COVERS[c.cover]||{c1:'#141B2D',c2:'#E3101F'};return `<div class="libitem ${a?'on':''}">
      <span class="libsw" style="--c1:${cv.c1};--c2:${cv.c2}">${c.steps.length}</span>
      <div class="libtx"><b>${esc(c.title)}</b><small>${c.steps.length} bosqich · har biri ${c.xp} XP · ${esc(c.note)}</small><a class="liblink" href="${esc(c.steps.length>1?docHome(c.steps[0].l):c.steps[0].l)}" target="_blank" rel="noopener">Ko‘rib chiqish →</a></div>
      ${a?`<span class="tag ok">${a.hidden?'E’lon qilingan (yashirilgan)':'✓ E’lon qilingan'}</span>`:`<button class="btn red libpub" data-lib="${i}">E’lon qilish</button>`}</div>`}).join('')}</div>
    ${LIB.some(c=>!pub(c))?`<button class="btn ghost" id="libAll" style="margin-top:12px">Hammasini e’lon qilish</button>`:''}
  </div>`;
  $('#tBody').innerHTML=libHTML+`<div class="card sec">
    <h3>Yangi topshiriq (xarita)</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 6px">Har bir bosqich o‘quvchi xaritasida bitta nuqta bo‘ladi. Bosqichlar ketma-ket ochiladi.</p>
    <div class="agrid">
      <div class="field"><label for="aT">Nomi</label><input id="aT" placeholder="Listening Part 2 Booster"></div>
      <div class="field"><label for="aN">Qisqa izoh (ixtiyoriy)</label><input id="aN" placeholder="9 ta test, har biri skript bilan"></div>
    </div>
    <div class="field"><label>Bosqichlar</label><div id="stList">${ui.steps.map((s,i)=>stepRow(i,s)).join('')}</div>
      <button class="btn ghost" id="stAdd" style="margin-top:8px">+ Bosqich qo‘shish</button></div>
    <div class="agrid">
      <div class="field"><label for="aX">Har bir bosqich uchun XP</label><input id="aX" type="number" min="1" max="100" value="10" inputmode="numeric"></div>
      <div class="field"><label>Kimlarga</label><div class="gchips">${['ALL',...GROUPS].map(g=>`<button class="gchip ${g==='ALL'?'on':''}" data-g="${g}">${g==='ALL'?'Hammaga':g==='GUEST'?'Mehmonlar':g}</button>`).join('')}</div></div>
    </div>
    <div class="field"><label>Banner</label><div class="cvchips">${Object.entries(COVERS).filter(([k])=>k!=='booster'&&!/^l[pb]\d$/.test(k)&&(G3?!/^(rp|wr|ai)/.test(k):!/^(u\d|rc)/.test(k))).map(([k,c],j)=>`<button class="cvchip ${j?'':'on'}" data-cv="${k}" style="--c1:${c.c1};--c2:${c.c2}">${c.l}</button>`).join('')}</div></div>
    <button class="btn red big" id="aAdd" style="margin-top:14px">E’lon qilish</button>
  </div>
  <h2 class="sech">Barcha topshiriqlar</h2>
  <div class="alist">
    <div class="card asg main ${G3?'hide':''}"><div class="aic">📖</div><div class="atx"><div class="at">Reading Part 1 Booster</div><div class="as">30 bosqich, har doim hammaga ko‘rinadi. XP avtomatik.</div>
      <div><span class="tag ok">${bRows.filter(x=>x.done>=BOOSTER_TESTS).length}/${bRows.length} tugatdi</span> <span class="tag">${bRows.filter(x=>x.done).length} boshladi</span></div></div></div>
    ${TD.assignments.slice().reverse().map(a=>{const c=cnt(a);return `<div class="card asg ${a.hidden?'hid':''}">
    <div class="aic">${a.hidden?'🙈':'🗺️'}</div>
    <div class="atx"><div class="at">${esc(a.title)}</div><div class="as">${a.steps.length} bosqich, har biri ${a.xp} XP, ${esc(a.groups==='ALL'?'hammaga':a.groups)}${a.note?', '+esc(a.note):''}</div>
      <div><span class="tag ok">${c.fin}/${c.tot} tugatdi</span> <span class="tag">${c.st} boshladi</span></div></div>
    <div class="abtns"><button class="btn ghost" data-hide="${a.aid}" data-h="${a.hidden?0:1}">${a.hidden?'Ko‘rsatish':'Yashirish'}</button><button class="btn ghost" data-del="${a.aid}" aria-label="O‘chirish">🗑</button></div>
  </div>`}).join('')}</div>`;
  const sync=()=>{ui.steps=[...document.querySelectorAll('.steprow')].map(r=>({t:r.querySelector('.stT').value,l:r.querySelector('.stL').value}))};
  const redraw=()=>{$('#stList').innerHTML=ui.steps.map((s,i)=>stepRow(i,s)).join('')};
  $('#stList').oninput=sync;
  document.querySelectorAll('.cvchip').forEach(b=>b.onclick=()=>document.querySelectorAll('.cvchip').forEach(x=>x.classList.toggle('on',x===b)));
  $('#stList').onclick=e=>{const b=e.target.closest('.stX');if(!b)return;sync();ui.steps.splice(+b.closest('.steprow').dataset.k,1);if(!ui.steps.length)ui.steps=[{t:'',l:''}];redraw()};
  $('#stAdd').onclick=()=>{sync();ui.steps.push({t:'',l:''});redraw();const r=document.querySelectorAll('.steprow');r[r.length-1].querySelector('.stT').focus()};
  const chips=(sel,attr)=>document.querySelectorAll(sel).forEach(b=>b.onclick=()=>{const all=b.dataset[attr]==='ALL';
    document.querySelectorAll(sel).forEach(x=>{if(all)x.classList.toggle('on',x===b);else if(x.dataset[attr]==='ALL')x.classList.remove('on')});
    if(!all)b.classList.toggle('on');if(!document.querySelector(sel+'.on'))document.querySelector(sel+'[data-'+attr+'="ALL"]').classList.add('on')});
  chips('.gchip[data-g]','g');chips('.lgchip','lg');
  const libPub=async list=>{const g=[...document.querySelectorAll('.lgchip.on')].map(x=>x.dataset.lg).join(',')||'ALL';
    document.querySelectorAll('.libpub,#libAll').forEach(b=>b.disabled=true);let n=0;
    try{for(const c of list){const j=await cpost({action:'addAssign',key:U.pass,title:c.title,note:c.note,steps:c.steps,xp:c.xp,groups:g,cover:c.cover});if(!j.ok)throw 0;n++;
        if(c.steps.some(x=>isExam(x.l))){const d=examDoc(c.steps[0].l);const old=TD.assignments.filter(a=>!a.hidden&&a.steps.length>1&&a.steps.every(x=>examDoc(x.l)===d&&!isExam(x.l)));
          for(const o of old)await cpost({action:'editAssign',key:U.pass,aid:o.aid,hidden:true})}}
      toast(n>1?n+' ta material e’lon qilindi':'E’lon qilindi')}catch(e){toast(n?n+' tasi e’lon qilindi, qolgani chiqmadi. Qayta urining.':'E’lon qilinmadi. Qayta urining.')}
    TD=null;try{await loadT()}catch(e){}teacherHome('assign')};
  document.querySelectorAll('.libpub').forEach(b=>b.onclick=()=>libPub([LIB[+b.dataset.lib]]));
  const la=$('#libAll');if(la)la.onclick=()=>{const todo=LIB.filter(c=>!pub(c));modal(`<h3>${todo.length} ta materialni e’lon qilasizmi?</h3><p class="muted" style="margin-top:6px">${todo.map(c=>esc(c.title)).join(', ')}.</p>`,[{t:'Bekor qilish'},{t:'E’lon qilish',cls:'red',f:()=>libPub(todo)}])};
  $('#aAdd').onclick=async()=>{sync();const t=$('#aT').value.trim();if(!t){toast('Nomini yozing');$('#aT').focus();return}
    const steps=ui.steps.map((s,i)=>{let l=s.l.trim();if(l&&!/^https?:\/\//.test(l)&&!/^(mashq|viewer|grammar)\.html#/.test(l))l='https://'+l;return{t:s.t.trim()||('Bosqich '+(i+1)),l}}).filter((s,i)=>s.t||s.l);
    const g=[...document.querySelectorAll('.gchip[data-g].on')].map(x=>x.dataset.g).join(',')||'ALL';
    $('#aAdd').disabled=true;$('#aAdd').textContent='E’lon qilinmoqda…';
    const cover=(document.querySelector('.cvchip.on')||{}).dataset?.cv||'';
    try{const j=await cpost({action:'addAssign',key:U.pass,title:t,note:$('#aN').value.trim(),steps,xp:+$('#aX').value||10,groups:g,cover});if(!j.ok)throw 0;
      ui.steps=null;toast('E’lon qilindi');TD=null;await loadT();teacherHome('assign')}catch(e){toast('E’lon qilinmadi. Qayta urining.');$('#aAdd').disabled=false;$('#aAdd').textContent='E’lon qilish'}};
  document.querySelectorAll('[data-hide]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await cpost({action:'editAssign',key:U.pass,aid:b.dataset.hide,hidden:b.dataset.h==='1'});TD=null;await loadT();teacherHome('assign')}catch(e){toast('Xatolik')}});
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>modal('<h3>Topshiriqni o‘chirasizmi?</h3><p class="muted" style="margin-top:6px">O‘quvchilar uni boshqa ko‘rmaydi va bu topshiriq uchun olingan XP hisobdan chiqadi.</p>',
    [{t:'Bekor qilish'},{t:'O‘chirish',cls:'red',f:async()=>{try{await cpost({action:'editAssign',key:U.pass,aid:b.dataset.del,remove:true});TD=null;await loadT();teacherHome('assign')}catch(e){toast('Xatolik')}}}]));
}
/* ---------- monitoring (Multi-Level, 25.11.2026): what each student does, every checked result with every answer ---------- */
function resRow(r,who){const pc=pctOf(r);
  return `<button class="rrow lnkrow" data-rp="${r.p}"><span class="rsc ${pcCls(pc)}">${r.k==='exam'&&r.b!=null?r.b:r.ok+'/'+r.of}</span>
    <span class="rtx"><b>${who?esc(who)+' · ':''}${esc(r.ti||'Mashq')}</b><small>${dmY(r.at)} ${hm(r.at)}${r.sec?' · '+durUz(r.sec):''}${r.k==='exam'?' · '+(r.lv?esc(r.lv):'')+' · '+r.ok+'/'+r.of:''}</small></span><em>${pc}%</em><span class="aiar">›</span></button>`}
function bindRes(){document.querySelectorAll('[data-rp]').forEach(b=>b.onclick=()=>resDetail(+b.dataset.rp))}
async function resDetail(p){
  modal('<div class="loading"><div class="spin"></div>Yuklanmoqda…</div>',[{t:'Yopish'}]);
  let j=null;try{j=await cget({action:'tdet',key:U.pass,p},20000)}catch(e){}
  const box=document.querySelector('.modal-bg .modal')||document.querySelector('.modal-bg>div');if(!box)return;const tgt=box.querySelector('.loading');
  if(!j||!j.ok){if(tgt)tgt.outerHTML='<p class="muted">Yuklanmadi. Qayta urinib ko‘ring.</p>';return}
  const r=j.r,pc=pctOf(r),s=(TD.roster.find(x=>x.id===r.id)||{name:r.id});
  const html=`<div class="rdet"><small class="muted">${esc(s.name)} · ${dmY(r.at)} ${hm(r.at)}${r.sec?' · '+durUz(r.sec):''}</small><h3>${esc(r.ti||'Mashq')}</h3>
    <div class="rdsum"><span class="rsc ${pcCls(pc)}">${r.ok}/${r.of}</span><b>${pc}%</b>${r.k==='exam'&&r.b!=null?`<span class="tag ok">${r.b} ball · ${esc(r.lv||'')}</span>`:''}</div>
    ${r.per&&r.per.length?`<table class="rdper"><tbody>${r.per.map(x=>`<tr><td>${esc(x.l)}</td><td>${esc(x.t||'')}</td><td><b>${x.ok}/${x.of}</b></td></tr>`).join('')}</tbody></table>`:''}
    <h4>Har bir javob</h4><div class="dets">${(r.det||[]).map(([n,g,ok,rt])=>`<div class="det ${ok?'ok':'bad'}"><b>${esc(n)}</b><span>${g?esc(g):'<i>bo‘sh</i>'}</span>${ok?'<em class="okm">✓</em>':`<em>to‘g‘ri: ${esc(rt)}</em>`}</div>`).join('')||'<p class="muted">Javoblar saqlanmagan.</p>'}</div></div>`;
  if(tgt)tgt.outerHTML=html}
function tStuAct(j){const a=actOf(j),R=j.res||[],avg=R.length?Math.round(R.reduce((q,r)=>q+pctOf(r),0)/R.length):null;
  const byT=R.slice().sort((q,w)=>q.at-w.at);
  const acc=byT.slice(-30).map(r=>({l:dmY(r.at),v:pctOf(r),t:r.ok+'/'+r.of+' · '+pctOf(r)+'%'}));
  const ex=byT.filter(r=>r.k==='exam'&&r.b!=null).map(r=>({l:dmY(r.at),v:r.b,t:r.b+' ball · '+(r.lv||'')}));
  const sk={};R.forEach(r=>{const k=skillOf(r,TD.assignments);(sk[k]=sk[k]||[]).push(pctOf(r))});
  const skills=Object.entries(sk).map(([k,v])=>[k,Math.round(v.reduce((q,w)=>q+w,0)/v.length),v.length]).sort((q,w)=>w[2]-q[2]);
  return `<div class="pft tpft">
    <div class="card"><b>🔥 ${a.cur}</b><span>kun ketma-ket${a.today?' · bugun kirdi':''}</span></div>
    <div class="card"><b>${a.best}</b><span>eng uzun seriya</span></div>
    <div class="card"><b>${a.total}</b><span>jami faol kun</span></div>
    <div class="card"><b>${R.length}</b><span>tekshirilgan mashq</span></div>
    <div class="card"><b>${avg==null?'–':avg+'<small>%</small>'}</b><span>o‘rtacha natija</span></div>
    <div class="card"><b>${(j.xp&&j.xp.G)||0}</b><span>seriya sovg‘a XP</span></div></div>
  ${acc.length?`<div class="card pfc"><h3>Natijalar chizig‘i <small>oxirgi ${acc.length} ta, foizda</small></h3><div class="cwrap" style="--cc:#E3101F">${lineChart(acc,{min:0,max:100,unit:'%',grid:[0,50,100],label:'Natijalar'})}</div></div>`:''}
  ${ex.length?`<div class="card pfc"><h3>Mock testlar <small>ball, 75 dan</small></h3><div class="cwrap" style="--cc:#159947">${lineChart(ex,{min:0,max:75,grid:[0,38,75],bands:[[38,'B1'],[51,'B2'],[65,'C1']],label:'Mock testlar'})}</div></div>`:''}
  ${skills.length?`<div class="card pfc"><h3>Ko‘nikmalar <small>o‘rtacha foiz</small></h3><div class="skl">${skills.map(([k,v,n])=>`<div class="skr"><span>${esc(k)}<small>${n} ta</small></span><div class="skb"><b class="${pcCls(v)}" style="width:${Math.max(3,v)}%"></b></div><em>${v}%</em></div>`).join('')}</div></div>`:''}
  <div class="card pfc"><h3>Faollik kalendari <small>oxirgi 12 hafta</small></h3>${heatHTML(a.days,a.now,12)}</div>
  <h2 class="sech">Barcha natijalar <small class="muted">${R.length} ta · bosing — har bir javob</small></h2>
  <div class="card rlist">${R.length?R.map(r=>resRow(r)).join(''):'<p class="muted empty">Hali tekshirilgan mashq yo‘q. O‘quvchi mashqda “Javoblarni tekshirish”ni bosganda shu yerda chiqadi.</p>'}</div>
  <h2 class="sech">Kirish tarixi</h2><div class="card" id="tVis"><div class="loading"><div class="spin"></div>Yuklanmoqda…</div></div>`}
async function tVisits(id){let j=null;try{j=await cget({action:'tvis',key:U.pass,id},20000)}catch(e){}const b=$('#tVis');if(!b)return;
  if(!j||!j.ok){b.innerHTML='<p class="muted">Yuklanmadi.</p>';return}
  const V=j.vis.slice().reverse();b.innerHTML=V.length?`<table class="vtab"><thead><tr><th>Kun</th><th>Birinchi kirish</th><th>Oxirgi faollik</th><th>Necha marta</th></tr></thead><tbody>${V.slice(0,60).map(v=>`<tr><td><b>${v.d.split('-').reverse().join('.')}</b> <small>${WD[new Date(v.d+'T12:00:00Z').getUTCDay()]}</small></td><td>${hm(v.f)}</td><td>${hm(v.l)}</td><td>${v.n}</td></tr>`).join('')}</tbody></table>${V.length>60?`<p class="muted">… yana ${V.length-60} kun</p>`:''}`:`<p class="muted empty">Hali kirmagan (${G3?'hisob platforma yangilangan kundan boshlangan':'hisob 25.11.2026 dan boshlangan'}).</p>`}
async function tAct(){
  const B=$('#tBody');B.innerHTML='<div class="loading" style="margin-top:30px"><div class="spin"></div>Yuklanmoqda…</div>';
  let j=null;try{j=await cget({action:'tact',key:U.pass,days:14},30000)}catch(e){}
  if(!j||!j.ok){B.innerHTML='<div class="card sec"><h3>Yuklanmadi</h3><p class="muted">Internetni tekshiring, so‘ng “Yangilash”ni bosing.</p></div>';return}
  const F=ui.af=ui.af||{g:'ALL',q:'',k:'',n:120};
  const S={};TD.roster.forEach(s=>S[s.id]=s);const A={};TD.assignments.forEach(a=>A[a.aid]=a);
  const ok=id=>!!S[id]&&(F.g==='ALL'||S[id].group===F.g)&&(!F.q||(S[id].name+' '+id).toLowerCase().includes(F.q.toLowerCase()));
  const ev=[];j.res.forEach(r=>ev.push({t:r.at,id:r.id,ty:'res',r}));
  j.prog.forEach(p=>{const k=String(p.a).split(':'),a=A[k[0]];if(a)ev.push({t:p.at,id:p.id,ty:p.st,a,i:+k[1],info:p.i})});
  ev.sort((x,y)=>y.t-x.t);
  const tday=j.vis.filter(v=>v.d===j.today),seen7=new Set(j.vis.filter(v=>dnum(v.d)>dnum(j.today)-7).map(v=>v.id));
  const studs=TD.roster.filter(s=>s.type!=='guest'),away=studs.filter(s=>!seen7.has(s.id));
  const days=[];for(let n=dnum(j.today)-13;n<=dnum(j.today);n++){const d=dstr(n);days.push([d,new Set(j.vis.filter(v=>v.d===d&&S[v.id]&&S[v.id].type!=='guest').map(v=>v.id)).size])}
  const mx=Math.max(1,...days.map(d=>d[1]));
  const who=id=>{const s=S[id];return `<button class="who" data-s="${esc(id)}">${avHTML((TD.av||{})[id],s.name,lvIdx(xpOf(id).T),'xs')}<b>${esc(s.name)}</b><small>${esc(s.group)}</small></button>`};
  const dayH=d=>d===j.today?'Bugun':dnum(d)===dnum(j.today)-1?'Kecha':d.split('-').reverse().join('.')+' · '+WD[new Date(d+'T12:00:00Z').getUTCDay()];
  const draw=()=>{const L=ev.filter(e=>ok(e.id)&&(!F.k||(F.k==='res'?e.ty==='res':e.ty!=='res')));let last='',html='';
    L.slice(0,F.n).forEach(e=>{const d=new Date(e.t),ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      if(ds!==last){html+=`<h4 class="evd">${dayH(ds)}</h4>`;last=ds}
      const st=e.a?(e.a.steps[e.i]||{}).t||('Bosqich '+(e.i+1)):'';
      html+=`<div class="ev">${who(e.id)}<span class="evt">${hm(e.t)}</span>${e.ty==='res'?resRow(e.r).replace('class="rrow lnkrow"','class="rrow lnkrow evr"')
        :`<span class="evx ${e.ty==='done'?'dn':''}">${e.ty==='done'?'✔ bajardi':'📂 ochdi'}: <b>${esc(e.a.title)}</b> · ${esc(st)}${e.info?` <span class="tag ok">${esc(e.info)}</span>`:''}</span>`}</div>`});
    $('#evList').innerHTML=html||'<p class="muted empty">Hozircha hech narsa yo‘q. O‘quvchilar mashq bajarganda shu yerda ko‘rinadi.</p>';
    $('#evMore').hidden=L.length<=F.n;
    document.querySelectorAll('#evList [data-s]').forEach(b=>b.onclick=()=>go('#/teacher/s/'+encodeURIComponent(b.dataset.s)));bindRes()};
  B.innerHTML=`<div class="card pfc"><h3>Kunlik faollik <small>platformaga kirgan o‘quvchilar, 14 kun</small></h3>
      <div class="dbars">${days.map(([d,n])=>`<div class="dbar ${d===j.today?'td':''}" title="${d}: ${n} o‘quvchi"><em>${n||''}</em><b style="height:${Math.round(n/mx*100)}%"></b><small>${d.slice(8)}</small></div>`).join('')}</div></div>
    <div class="actg"><div class="card sec"><h3>Bugun platformada <b class="cnt">${tday.filter(v=>S[v.id]).length}</b></h3><div class="whos">${tday.filter(v=>S[v.id]).map(v=>`<div class="whor">${who(v.id)}<small>${hm(v.f)}–${hm(v.l)} · ${v.n} marta</small></div>`).join('')||'<p class="muted">Bugun hali hech kim kirmadi.</p>'}</div></div>
      <div class="card sec"><h3>7 kundan beri kirmagan <b class="cnt warn">${away.length}</b></h3><p class="muted" style="font-size:13px;margin:2px 0 8px">${G3?'Hisob platforma yangilangan kundan boshlangan':'Hisob 25.11.2026 dan boshlangan'}.</p><div class="whos">${away.slice(0,60).map(s=>`<div class="whor">${who(s.id)}${s.phone&&s.phone.length===9?`<a class="btn ghost call" href="${tel(s.phone)}">📞</a>`:''}</div>`).join('')||'<p class="muted">Hamma faol 👏</p>'}</div></div></div>
    <h2 class="sech">Nima qilishyapti</h2>
    <div class="tfil"><input id="evQ" placeholder="Ism yoki ID" value="${esc(F.q)}" aria-label="Qidirish"><select id="evG" aria-label="Guruh"><option value="ALL">Barcha guruhlar</option>${tGroups().map(g=>`<option ${F.g===g?'selected':''}>${esc(g)}</option>`).join('')}</select>
      <select id="evK" aria-label="Turi"><option value="">Hammasi</option><option value="res" ${F.k==='res'?'selected':''}>Faqat natijalar</option><option value="st" ${F.k==='st'?'selected':''}>Faqat bosqichlar</option></select></div>
    <div id="evList" class="evl"></div><button class="btn ghost block" id="evMore" hidden>Yana ko‘rsatish</button>`;
  $('#evQ').oninput=e=>{F.q=e.target.value;draw()};$('#evG').onchange=e=>{F.g=e.target.value;draw()};$('#evK').onchange=e=>{F.k=e.target.value;draw()};
  $('#evMore').onclick=()=>{F.n+=120;draw()};
  document.querySelectorAll('.actg [data-s]').forEach(b=>b.onclick=()=>go('#/teacher/s/'+encodeURIComponent(b.dataset.s)));
  draw()}
async function teacherStudent(id){
  document.body.classList.remove('st-mode');
  setBack('#/teacher/'+(ui.ttab||'students'),'Orqaga');
  view().innerHTML='<div class="wrap"><div class="loading" style="margin-top:60px"><div class="spin"></div>Yuklanmoqda…</div></div>';
  let j=null;try{await loadT();j=await cget({action:'tprofile',key:U.pass,id})}catch(e){}
  if(!j||!j.ok){view().innerHTML='<div class="wrap"><div class="card sec"><h3>O‘quvchi topilmadi</h3></div></div>';return}
  const r=TD.roster.find(x=>x.id===id)||{};const rk=myRank(j);const T=tracks(j);const st=bstats(j.booster);
  view().innerHTML=`<div class="wrap st anim">
    <div class="st-hello">${avHTML(j.av,j.student.name,lvIdx(j.xp.T),'md')}<div><h1>${esc(j.student.name)}</h1>
      <div class="st-meta"><span>ID ${esc(j.student.id)}</span><span>${esc(j.student.group)}</span><span>${j.xp.T} XP</span>${rk?`<span>${rk.me.r}-o‘rin</span>`:''}</div></div>
      ${r.phone&&r.phone.length===9?`<a class="btn ghost call" href="${tel(r.phone)}">📞<span>${phoneNice(r.phone)}</span></a>`:''}
      ${r.tgu?`<a class="btn ghost tgb" href="https://t.me/${esc(r.tgu.slice(1))}" target="_blank" rel="noopener">${TGI}<span>${esc(r.tgu)}</span></a>`:''}
      ${r.tg?`<button class="btn ghost" id="tgUn">Telegramni uzish</button>`:''}
      <button class="btn ghost" id="stEdit">✎ Tahrirlash</button>
      ${r.type!=='guest'?`<button class="btn ghost" id="pinReset">${r.hasPin?'Parolni yangilash':'Parol hali yo‘q'}</button>`:''}
      ${G3?'':`<button class="btn ghost" id="aiOf">${AI_SVG.replace('<svg','<svg width="18" height="18"')}<span>AI tekshiruvlari</span></button>`}</div>
    ${tStuAct(j)}
    <h2 class="sech">Topshiriqlar</h2>
    <div class="alist">${T.map(t=>`<div class="card asg ${t.booster?'main':''}"><div class="aic">${t.finished?'🏆':t.booster?'📖':'🗺️'}</div>
      <div class="atx"><div class="at">${esc(t.title)}</div><div class="as">${t.done}/${t.total} bosqich, ${t.steps.reduce((a,b)=>a+(b.done?b.xp||0:0),0)} XP${t.steps.filter(x=>x.info).map(x=>' · Natija: '+esc(x.info)).join('')}</div>
      <div class="dots">${t.steps.map(s=>`<i class="${s.done?'on':''}" title="${esc(s.t)}"></i>`).join('')}</div></div></div>`).join('')}</div>
    ${st.read?`<h2 class="sech">Booster natijalari</h2><div class="card sec">${testBars(st)}</div>`:''}
    <a class="btn navy big ${G3?'hide':''}" style="margin-top:16px" href="${BOOSTER_URL}" target="_blank" rel="noopener">Booster bo‘yicha batafsil hisobot</a></div>`;
  const tu=$('#tgUn');if(tu)tu.onclick=()=>modal(`<h3>${esc(j.student.name)} Telegramini uzasizmi?</h3><p class="muted" style="margin-top:6px">O‘quvchi keyin profilidan qaytadan ulashi mumkin.${r.tgp?' Telegram raqami: '+phoneNice(r.tgp)+'.':''}</p>`,
    [{t:'Bekor qilish'},{t:'Uzish',cls:'red',f:async()=>{try{const x=await cpost({action:'tgUnlink',key:U.pass,id});if(!x.ok)throw 0;toast('Uzildi');TD=null;teacherStudent(id)}catch(e){toast('Xatolik')}}}]);
  $('#stEdit').onclick=()=>editStudentBox(r.id?r:null);
  bindRes();tVisits(id);
  const ao=$('#aiOf');if(ao)ao.onclick=()=>{ui.aiq=j.student.id;go('#/teacher/ai')};
  const pr=$('#pinReset');if(pr)pr.onclick=()=>{if(!r.hasPin){toast('O‘quvchi hali parol o‘rnatmagan');return}
    modal(`<h3>${esc(j.student.name)} uchun parolni yangilaysizmi?</h3><p class="muted" style="margin-top:6px">Eski parol ishlamay qoladi. Keyingi kirishda o‘quvchi yangi parol o‘ylab topadi.</p>`,
      [{t:'Bekor qilish'},{t:'Yangilash',cls:'red',f:async()=>{try{const x=await cpost({action:'resetPin',key:U.pass,id});if(!x.ok)throw 0;toast('Parol yangilandi');TD=null;teacherStudent(id)}catch(e){toast('Xatolik')}}}])};
}
function testBars(st){
  const W=600,H=110,bw=W/BOOSTER_TESTS;const m=Object.fromEntries(st.res);
  return `<svg class="chart" viewBox="0 0 ${W} ${H+26}" role="img" aria-label="Har bir test natijasi">${Array.from({length:BOOSTER_TESTS},(_,k)=>{const i=k+1,r=m[i];
    const h=r?Math.max(5,r.score/6*H):H;const c=!r?'var(--track)':r.score>=5?'#159947':r.score>=3?'#D98A06':'#E3101F';
    return `<rect x="${k*bw+3}" y="${H-h+2}" width="${bw-6}" height="${h}" rx="4" style="fill:${c}" ${r?'':'opacity=".5"'}/><text x="${k*bw+bw/2}" y="${H+20}" text-anchor="middle" font-size="9" font-weight="700" style="fill:var(--mute)">${i}</text>`}).join('')}</svg>`;
}
addEventListener('resize',()=>{clearTimeout(ui.rz);ui.rz=setTimeout(()=>{if(ui.stab==='map'&&ui.onResize&&location.hash.startsWith('#/me/a/'))ui.onResize()},150)});

/* ================= READING PART 1 BOOSTER — inside the platform (no separate page) =================
 * Same 30 tests, same A–E steps and the same saved data as the old booster.html,
 * so XP, the map, the ranking and the teacher's Booster report keep working. */
let BXT=null;
async function bxTests(){if(BXT)return BXT;const r=await fetch('rb1.json?v=2',{cache:'force-cache'});if(!r.ok)throw new Error('load');BXT=await r.json();return BXT}
const bxQ=()=>ST+'bxq:'+U.id;
function bxS(){P.booster=P.booster||{};P.booster.tests=P.booster.tests||{};return P.booster}
function bxApply(p){let q=null;try{q=JSON.parse(store(bxQ())||'null')}catch(e){}if(!q||!q.tests)return;
  const b=p.booster=p.booster||{};b.tests=b.tests||{};
  Object.keys(q.tests).forEach(k=>{const n=q.tests[k],o=b.tests[k],was=!!(o&&o.kwt&&o.res);
    if(!o||(n.res&&!o.res)||(n.kwt&&!o.kwt)){b.tests[k]=Object.assign({},o||{},n);if(!was&&n.kwt&&n.res){const x=bxp(p,n.res.score);p.xp.B+=x;p.xp.bn++;p.xp.T+=x}}});
  const m=(p.board||[]).find(r=>r.me);if(m)m.t=p.xp.T}
async function bxFlush(){if(!store(bxQ())||!P)return;const S=bxS();
  const data=Object.assign({},S,{key:U.id,name:P.student.name,group:P.student.group,updated:Date.now()});
  try{const j=await cpost({action:'save',app:'booster',key:U.id,data});if(j&&j.ok)store(bxQ(),null)}catch(e){}}
function bxSave(){const S=bxS();S.updated=Date.now();store(bxQ(),JSON.stringify({tests:S.tests,updated:S.updated}));store(ST+'p:'+U.id,JSON.stringify(P));bxFlush()}
const bxNorm=s=>String(s||'').toLowerCase().replace(/[’‘`]/g,"'").replace(/^[\s"'.,;:!?()]+|[\s"'.,;:!?()]+$/g,'').replace(/\s+/g,' ');
const bxRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const bxFmt=ms=>{const s=Math.round(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const bxShuf=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
function bxLev(a,b){const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
function bxCls(t,i,u){const a=t.ans[i].toLowerCase();u=bxNorm(u);if(!u)return'blank';if(u===a)return'ok';if(u.split(' ').length>1)return'multi';
  if(u+'s'===a||a+'s'===u||u+'es'===a||a+'es'===u||(u==='feet'&&a==='foot')||(u==='foot'&&a==='feet'))return'plural';
  if(a.length>=4&&bxLev(u,a)<=2)return'spelling';if(!new RegExp('\\b'+bxRe(u)+'\\b','i').test(t.text.replace(/\{\d\}/g,' ')))return'notext';return'wrong'}
const BXCAT={ok:'To‘g‘ri',blank:'Bo‘sh qoldirilgan',plural:'Birlik / ko‘plik xatosi',spelling:'Imlo xatosi',notext:'Bu so‘z matnda yo‘q',wrong:'Matndagi boshqa so‘z',multi:'Bittadan ko‘p so‘z'};
const BXST=[['A','Matn'],['B','Kalit so‘zlar'],['C','Bo‘sh joy turi'],['D','So‘z juftliklari'],['E','Qisqa mazmun']];
function bxGloss(t){const g={};Object.entries(t.gloss||{}).forEach(([k,v])=>g[k.toLowerCase()]=v);(t.table||[]).forEach(r=>{const k=r[0].toLowerCase();if(!t.ans.includes(k)&&!g[k])g[k]=r[2]});return g}
function bxGlossify(txt,g){const ks=Object.keys(g).sort((a,b)=>b.length-a.length);if(!ks.length)return esc(txt);const re=new RegExp('\\b('+ks.map(bxRe).join('|')+')\\b','gi');return esc(txt).replace(re,m=>`<span class="bx-gl" data-k="${esc(m.toLowerCase())}">${m}</span>`)}
function bxFull(t){return t.text.replace(/\{(\d)\}/g,(m,n)=>t.ans[n-1])}
function bxSent(txt,re){const s=txt.replace(/\n\n/g,' ').match(/[^.!?]+[.!?]+/g)||[txt];return(s.find(x=>re.test(x))||'').trim()}
function bxEvidence(t,i){const g=t.text.replace(/\{(\d)\}/g,'_____');const re=new RegExp('\\b('+bxRe(t.ans[i])+')\\b','i');const s=bxSent(g,re);return s?esc(s).replace(re,'<mark>$1</mark>'):''}
function bxCtx(t,w){const re=new RegExp('\\b('+bxRe(w)+')\\b','i');let x=bxSent(bxFull(t),re);const m=x.search(re);
  if(x.length>100){const a=Math.max(0,m-42),b=Math.min(x.length,m+w.length+46);x=(a>0?'…':'')+x.slice(a,b)+(b<x.length?'…':'')}return esc(x).replace(re,'<b>$1</b>')}
function bxRing(v,max,col){const r=52,c=2*Math.PI*r,p=max?v/max:0;return `<svg viewBox="0 0 128 128" class="bx-ringsvg"><circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--track)" stroke-width="12"/><circle cx="64" cy="64" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-o="${c*(1-p)}" class="bx-rg" transform="rotate(-90 64 64)"/></svg>`}
function bxAnim(){requestAnimationFrame(()=>requestAnimationFrame(()=>document.querySelectorAll('.bx-rg').forEach(e=>e.style.strokeDashoffset=e.dataset.o)))}
function bxHead(t,step,extra){return `<div class="bx-head"><div class="bx-ht"><small>Reading Part 1 · Test ${t.id} / ${BOOSTER_TESTS}</small><h1>${esc(t.title)}</h1></div>${extra||''}</div>
  <ol class="bx-steps">${BXST.filter(s=>t.extra||'AB'.includes(s[0])).map(([k,l])=>{const o=BXST.findIndex(x=>x[0]===k),c=BXST.findIndex(x=>x[0]===step);return `<li class="${o<c?'done':o===c?'on':''}"><i>${o<c?'✓':k}</i><span>${l}</span></li>`}).join('')}</ol>`}
function bxPop(el,txt){document.querySelectorAll('.bx-pop').forEach(x=>x.remove());const r=el.getBoundingClientRect(),p=document.createElement('div');p.className='bx-pop';p.innerHTML=`<small>${esc(el.textContent)}</small>${esc(txt)}`;document.body.appendChild(p);
  const w=p.offsetWidth;p.style.left=Math.max(10,Math.min(innerWidth-w-10,r.left+r.width/2-w/2))+'px';p.style.top=(r.top+scrollY-p.offsetHeight-8)+'px';setTimeout(()=>p.remove(),3200)}
addEventListener('scroll',()=>document.querySelectorAll('.bx-pop').forEach(x=>x.remove()),{passive:true});

async function bxOpen(n){
  document.body.classList.add('st-mode');setBack('#/me/a/'+BOOSTER_AID,'Xarita');ui.stab='bx';
  view().innerHTML='<div class="wrap"><div class="loading" style="margin-top:60px"><div class="spin"></div>Yuklanmoqda…</div></div>';
  let T;try{T=await bxTests()}catch(e){view().innerHTML=`<div class="wrap"><div class="card sec"><h3>Test yuklanmadi</h3><p class="muted">Internetni tekshirib, qayta urinib ko‘ring.</p><button class="btn red big" onclick="route()">Qayta urinish</button></div></div>`;return}
  const t=T.find(x=>x.id===n);if(!t){go('#/me/a/'+BOOSTER_AID,true);return}
  const d=bxS().tests[n]||{};ui.bx={t,n};
  if(!d.res)bxTest(t);else if(!d.kwt)bxResult(t,true);else bxFinal(t,false);
}
/* ---------- A · the test ---------- */
function bxTest(t){
  const k=ST+'bxp:'+U.id+':'+t.id;let pr=null;try{pr=JSON.parse(store(k)||'null')}catch(e){}
  pr=pr||{ans:['','','','','',''],acc:0,uz:0,blurs:0,started:false};pr.seg=Date.now();
  const sv=()=>{const now=Date.now();if(pr.started){pr.acc+=now-pr.seg}pr.seg=now;store(k,JSON.stringify(pr))};
  const g=bxGloss(t);
  const paras=t.text.split('\n\n').map(p=>'<p>'+p.split(/\{(\d)\}/).map((s,i)=>i%2?`<span class="bx-gap ${pr.ans[s-1]?'f':''}"><b>${s}</b><input data-q="${s-1}" value="${esc(pr.ans[s-1])}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="${s}-bo‘sh joy"></span>`:bxGlossify(s,g)).join('')+'</p>').join('');
  view().innerHTML=`<div class="wrap bx anim">${bxHead(t,'A',`<div class="bx-dots" id="bxDots">${[1,2,3,4,5,6].map(i=>`<i>${i}</i>`).join('')}</div>`)}
    <div class="bx-help"><b>Har bir bo‘sh joyga BITTA so‘z yozing.</b> Kerakli so‘z matnning boshqa joyida albatta bor. Nuqtali chiziq ostidagi so‘zni bossangiz, o‘zbekcha ma’nosi chiqadi.<small>Fill each gap with ONE word from the text.</small></div>
    <article class="bx-pass"><h2>${esc(t.title)}</h2>${paras}
      ${pr.started?'':`<div class="bx-cover"><div class="bx-start"><small>Test ${t.id} · 6 savol · ~8 daqiqa</small><h3>${esc(t.title)}</h3>
        <ul><li>6 ta bo‘sh joy — har biriga matndan bitta so‘z</li><li>Ekranda taymer yo‘q, lekin vaqtingiz yoziladi</li><li>Bitta urinish: tugatgach javoblarni ko‘rasiz</li></ul>
        <button class="btn red big block" id="bxGo">Boshlash</button></div></div>`}</article>
    <div class="bx-bar"><span id="bxCnt"></span><button class="btn red big" id="bxFin" ${pr.started?'':'disabled'}>Tugatish</button></div></div>`;
  const upd=()=>{const c=pr.ans.filter(a=>a.trim()).length;$('#bxCnt').innerHTML=`<b>${c}</b> / 6 javob`;document.querySelectorAll('#bxDots i').forEach((d,i)=>d.classList.toggle('f',!!pr.ans[i].trim()))};upd();
  const st=$('#bxGo');if(st)st.onclick=()=>{pr.started=true;pr.seg=Date.now();sv();sfx('open');$('.bx-cover').remove();$('#bxFin').disabled=false;const f=$('.bx-gap input');if(f)f.focus()};
  document.querySelectorAll('.bx-gap input').forEach(inp=>{inp.oninput=()=>{pr.ans[+inp.dataset.q]=inp.value;inp.parentNode.classList.toggle('f',!!inp.value.trim());sv();upd()};
    inp.onkeydown=e=>{if(e.key==='Enter'){const all=[...document.querySelectorAll('.bx-gap input')],nx=all[all.indexOf(inp)+1];nx?nx.focus():inp.blur()}}});
  document.querySelectorAll('.bx-gl').forEach(el=>el.onclick=e=>{e.stopPropagation();bxPop(el,g[el.dataset.k]);if(pr.started){pr.uz++;sv()}});
  ui.bxVis=()=>{if(!pr.started||!document.body.contains($('#bxFin')))return;if(document.hidden){sv();pr.blurs++;store(k,JSON.stringify(pr))}else pr.seg=Date.now()};
  $('#bxFin').onclick=()=>{const blank=pr.ans.filter(a=>!a.trim()).length,multi=pr.ans.some(a=>a.trim().split(/\s+/).length>1);
    modal(`<h3>Testni tugatasizmi?</h3>${blank?`<p style="margin-top:8px">⚠️ <b>${blank} ta bo‘sh joy</b> qoldi. Bo‘sh qoldirmang — taxmin ham to‘g‘ri chiqishi mumkin.</p>`:''}${multi?'<p style="margin-top:8px">⚠️ Ba’zi javoblarda bir nechta so‘z bor. Faqat BITTA so‘z yozing.</p>':''}${!blank&&!multi?'<p class="muted" style="margin-top:8px">Shundan keyin javoblarni o‘zgartirib bo‘lmaydi.</p>':''}`,
      [{t:'Qaytish'},{t:'Tugatish',cls:'red',f:()=>{sv();const ans=pr.ans.map(a=>a.trim()),cat=ans.map((a,i)=>bxCls(t,i,a));
        const S=bxS();S.tests[t.id]=Object.assign(S.tests[t.id]||{},{res:{ans,cat,score:cat.filter(c=>c==='ok').length,time:Math.max(1000,pr.acc),blurs:pr.blurs,uz:pr.uz,at:Date.now()}});
        store(k,null);bxSave();
        sendRes({kind:'bx',doc:'booster',sec:String(t.id),aid:BOOSTER_AID,step:t.id-1,title:'Booster · Test '+t.id+' · '+t.title,ok:cat.filter(c=>c==='ok').length,of:6,secs:Math.round(Math.max(1000,pr.acc)/1000),det:ans.map((a,i)=>[String(i+1),a,cat[i]==='ok'?1:0,t.ans[i]])});
        bxResult(t,false)}}])};
}
document.addEventListener('visibilitychange',()=>{if(ui.bxVis)ui.bxVis()});
/* ---------- result of A ---------- */
function bxFeedback(t,r){const f=[],c=r.cat,m=r.time/60000;
  f.push(r.score===6?['🏆','A’lo! Hamma so‘zni topdingiz.']:r.score>=4?['👍','Yaxshi! Qizil javoblarni va so‘z uchragan gapni qayta o‘qing.']:['📌','Bu matn qiyin bo‘ldi. Qayta sekin o‘qib, har bir javobni matndan toping.']);
  if(c.includes('plural'))f.push(['🔤','Birlik / ko‘plik: bo‘sh joy atrofiga qarang — a / one / single → birlik; these / many / their → ko‘pincha ko‘plik.']);
  if(c.includes('spelling'))f.push(['✍️','Imlo xatosi: javob matnda bor — harfma-harf ko‘chiring.']);
  if(c.includes('notext'))f.push(['🔎','Matnda yo‘q so‘z yozdingiz. Qoida: javob doim matnning o‘zida bo‘ladi.']);
  if(c.includes('blank'))f.push(['⛔','Hech qachon bo‘sh qoldirmang — matndagi istalgan so‘z bo‘sh joydan yaxshiroq.']);
  if(c.includes('multi'))f.push(['1️⃣','Faqat BITTA so‘z. Imtihonda ikki so‘z — xato javob.']);
  if(m<4&&r.score<5)f.push(['⚡','Juda tez ishladingiz, lekin ball yo‘qotdingiz. Shoshilmang, har bir bo‘sh joyni tekshiring.']);
  if(m>12)f.push(['⏱',`Siz ${bxFmt(r.time)} sarfladingiz. Imtihonda 1-qismni taxminan 8 daqiqada tugating.`]);
  if(r.blurs>0)f.push(['🚪',`Test vaqtida ${r.blurs} marta boshqa ilovaga chiqdingiz. Imtihonda diqqatni bir joyda saqlang.`]);
  return f}
function bxResult(t,resume){
  const r=bxS().tests[t.id].res,col=r.score>=5?'#159947':r.score>=3?'#D98A06':'#E3101F';ui.bxVis=null;
  view().innerHTML=`<div class="wrap bx anim">${bxHead(t,'A')}
    <div class="bx-res"><div class="bx-ring">${bxRing(r.score,6,col)}<div><b>${r.score}/6</b><small>to‘g‘ri</small></div></div>
      <div class="bx-rinfo"><div class="bx-mini"><div><b>${Math.round(r.score/6*100)}%</b><span>aniqlik</span></div><div><b>${bxFmt(r.time)}</b><span>vaqt (me’yor 8:00)</span></div><div><b>${r.uz}</b><span>UZ yordam</span></div><div><b>${r.blurs}</b><span>chiqib ketish</span></div></div>
        <ul class="bx-fb">${bxFeedback(t,r).map(f=>`<li><i>${f[0]}</i><span>${f[1]}</span></li>`).join('')}</ul></div></div>
    <h2 class="bx-h2">Javoblar — so‘z matnning qayerida edi?</h2>
    <div class="bx-ans">${t.ans.map((a,i)=>{const ok=r.cat[i]==='ok';return `<div class="bx-an ${ok?'ok':'no'}"><span class="n">${ok?'✓':i+1}</span><div>
      <div class="w">${ok?esc(a):`${r.ans[i]?`<s>${esc(r.ans[i])}</s>`:'<em>(bo‘sh)</em>'} → <b>${esc(a)}</b>`} <span class="tag">${BXCAT[r.cat[i]]}</span></div><div class="ev">📍 ${bxEvidence(t,i)}</div></div></div>`}).join('')}</div>
    <div class="bx-bar"><button class="btn ghost" id="bxMap">Xarita</button><button class="btn red big" id="bxB">B · Kalit so‘zlar →</button></div></div>`;
  bxAnim();if(!resume){sfx(r.score>=4?'win':'complete')}
  $('#bxMap').onclick=()=>go('#/me/a/'+BOOSTER_AID);$('#bxB').onclick=()=>bxB(t,{});
}
/* ---------- tap-to-match (B and D) ---------- */
function bxMatch(t,o){
  const n=o.rows.length,k={placed:Array(n).fill(null),locked:Array(n).fill(false),rev:Array(n).fill(false),checks:0,first:null,chip:null,row:null,order:bxShuf([...Array(n).keys()])};
  view().innerHTML=`<div class="wrap bx anim">${bxHead(t,o.step)}
    <div class="bx-help">${o.help}</div>
    <div class="bx-mt" id="bxRows"></div>
    <div class="bx-bank"><div class="bx-bh"><b>So‘zlar banki</b><span id="bxHint"></span></div><div class="bx-chips" id="bxChips"></div></div>
    <div class="bx-bar"><button class="btn ghost hide" id="bxRev">Javoblarni ko‘rsatish</button><span></span><button class="btn red big" id="bxChk">Tekshirish</button></div></div>`;
  const draw=()=>{
    $('#bxRows').innerHTML=o.rows.map((r,i)=>{const p=k.placed[i],cls=k.rev[i]?'rev':k.locked[i]?'ok':p!=null?'full':k.row===i?'sel':'';
      return `<div class="bx-mr"><span class="i">${i+1}</span><div class="l"><b>${esc(r[0])}</b>${o.ctx?`<small>${bxCtx(t,r[0])}</small>`:''}${r[2]&&o.uz?`<button class="bx-uz" data-u="${i}">UZ</button><em class="hide" id="bxU${i}">${esc(r[2])}</em>`:''}</div>
        <span class="a">→</span><button class="bx-slot ${cls}" data-i="${i}">${p!=null?esc(o.rows[p][1])+(k.locked[i]&&!k.rev[i]?' ✓':''):k.chip!=null?'shu yerga':'bo‘sh'}</button></div>`}).join('');
    const used=new Set(k.placed.filter(x=>x!=null));
    $('#bxChips').innerHTML=k.order.map(j=>`<button class="bx-chip ${used.has(j)?'used':''} ${k.chip===j?'sel':''}" data-j="${j}">${esc(o.rows[j][1])}</button>`).join('');
    $('#bxHint').textContent=used.size===n?'Hammasi joylandi — “Tekshirish”ni bosing':k.chip!=null?'Endi bo‘sh katakni bosing':'So‘zni bosing, keyin katakni';
    document.querySelectorAll('.bx-chip').forEach(c=>c.onclick=()=>{const j=+c.dataset.j;if(used.has(j))return;sfx('tap');if(k.row!=null){k.placed[k.row]=j;k.row=null;k.chip=null}else k.chip=k.chip===j?null:j;draw()});
    document.querySelectorAll('.bx-slot').forEach(s=>s.onclick=()=>{const i=+s.dataset.i;if(k.locked[i])return;if(k.placed[i]!=null){k.placed[i]=null;k.row=null}else if(k.chip!=null){k.placed[i]=k.chip;k.chip=null}else k.row=k.row===i?null:i;draw()});
    document.querySelectorAll('.bx-uz').forEach(b=>b.onclick=()=>$('#bxU'+b.dataset.u).classList.toggle('hide'))};
  const finish=()=>{o.done(k.first==null?0:k.first);const b=$('#bxChk');b.textContent=o.nextLabel;b.onclick=o.next;$('#bxRev').classList.add('hide');sfx('win');toast(k.first===n?'Mukammal! 🎉':'Bajarildi ✓')};
  $('#bxChk').onclick=()=>{if(k.placed.some(p=>p==null)){sfx('warn');toast('Avval hamma katakni to‘ldiring');return}k.checks++;const wrong=[];let right=0;
    k.placed.forEach((p,i)=>{if(k.locked[i])return;if(p===i){k.locked[i]=true;right++}else{wrong.push(i);k.placed[i]=null}});if(k.first==null)k.first=right;draw();
    wrong.forEach(i=>{const s=document.querySelector(`.bx-slot[data-i="${i}"]`);s.classList.add('shake')});
    if(k.locked.every(Boolean)){finish();return}sfx('wrong');toast(`${n-wrong.length}/${n} to‘g‘ri — qolganlarini qayta urinib ko‘ring`);if(k.checks>=2)$('#bxRev').classList.remove('hide')};
  $('#bxRev').onclick=()=>{o.rows.forEach((r,i)=>{if(!k.locked[i]){k.placed[i]=i;k.locked[i]=true;k.rev[i]=true}});draw();finish()};
  draw();scrollTo(0,0);
}
function bxB(t,acc){bxMatch(t,{step:'B',rows:t.table,ctx:true,uz:true,
  help:'<b>Chapdagi so‘zlar matndan olingan.</b> Bankdan ularga MA’NOSI YAQIN so‘zni tanlab, katakka qo‘ying. Imtihon tuzuvchilar so‘zlarni aynan shunday almashtiradi: <i>switched off → turned off</i>.<small>Find a word or phrase with a similar meaning.</small>',
  done:f=>{acc.b=f},nextLabel:t.extra?'C · Bo‘sh joy turi →':'Tugatish',next:()=>t.extra?bxC(t,acc):bxDone(t,acc)})}
/* ---------- C · gap detective ---------- */
const BXWT={N:['Ot · bitta','Singular noun'],P:['Ot · ko‘p','Plural noun'],V:['Fe’l · harakat','Verb'],A:['Sifat','Adjective']};
function bxC(t,acc){let i=0,ok=0;
  const draw=()=>{const ex=t.extra.c[i],g=t.text.replace(/\n\n/g,' '),s=(g.match(/[^.!?]+[.!?]+/g)||[g]).find(x=>x.includes('{'+(i+1)+'}'))||'';
    view().innerHTML=`<div class="wrap bx anim">${bxHead(t,'C')}
      <div class="bx-help"><b>Yozishdan oldin so‘rang: bu bo‘sh joyga qanday so‘z kerak?</b> Bitta narsami, ko‘p narsami, harakatmi yoki sifatmi — atrofdagi so‘zlarga qarab tanlang.</div>
      <div class="bx-card"><div class="bx-ck">Bo‘sh joy ${i+1} / 6</div><p class="bx-sent">${esc(s.trim()).replace(/\{(\d)\}/g,(m,dd)=>+dd===i+1?`<span class="bx-gx">${i+1}</span>`:'_____')}</p>
        <div class="bx-wt">${['N','P','V','A'].map(k=>`<button data-k="${k}"><b>${BXWT[k][0]}</b><small>${BXWT[k][1]}</small></button>`).join('')}</div><div id="bxCf"></div></div>
      <div class="bx-bar"><span><b>${ok}</b> to‘g‘ri</span><button class="btn red big hide" id="bxNx">${i<5?'Keyingi →':'D · So‘z juftliklari →'}</button></div></div>`;
    let did=false;document.querySelectorAll('.bx-wt button').forEach(b=>b.onclick=()=>{if(did)return;did=true;const good=b.dataset.k===t.types[i];if(good)ok++;sfx(good?'correct':'wrong');
      b.classList.add(good?'ok':'no');if(!good)document.querySelector(`.bx-wt [data-k="${t.types[i]}"]`).classList.add('ok');
      $('#bxCf').innerHTML=`<div class="bx-cfb ${good?'ok':'no'}"><b>${good?'To‘g‘ri!':'Unchalik emas.'}</b> Belgi: <mark>${esc(ex[0])}</mark> ${esc(ex[2])}<div>Javob: <b>${esc(t.ans[i])}</b></div></div>`;
      const nb=$('#bxNx');nb.classList.remove('hide');nb.onclick=()=>{if(i<5){i++;draw();scrollTo(0,0)}else{acc.c=ok;bxD(t,acc)}}})};draw()}
function bxD(t,acc){bxMatch(t,{step:'D',rows:t.extra.d.map(r=>[r[0],r[1],r[2]]),ctx:false,uz:false,
  help:'<b>Bu so‘z juftliklari matndan olingan.</b> Har bir boshlang‘ich qismni uning jufti bilan birlashtiring va ularni bitta ibora sifatida yodlang — ular boshqa testlarda ham chiqadi.',
  done:f=>{acc.d=f},nextLabel:'E · Qisqa mazmun →',next:()=>bxE(t,acc)})}
/* ---------- E · summary ---------- */
function bxE(t,acc){const e=t.extra.e;
  view().innerHTML=`<div class="wrap bx anim">${bxHead(t,'E')}
    <div class="bx-help"><b>Bu — o‘sha matn, lekin boshqa so‘zlar bilan aytilgan.</b> Har bir bo‘sh joyga asl matndan BITTA so‘z yozing.</div>
    <article class="bx-pass"><h2>Qisqa mazmun</h2><p>${esc(e.text).replace(/\{(\d)\}/g,(m,n)=>`<span class="bx-gap"><b>${n}</b><input data-e="${n-1}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${n}-bo‘sh joy"></span>`)}</p></article>
    <div id="bxEf"></div>
    <div class="bx-bar"><button class="btn ghost" id="bxTx">Asl matn</button><button class="btn red big" id="bxEc">Tekshirish</button></div></div>`;
  scrollTo(0,0);
  $('#bxTx').onclick=()=>modal(`<h3>${esc(t.title)}</h3><div class="bx-modaltext">${bxFull(t).split('\n\n').map(p=>`<p>${esc(p)}</p>`).join('')}</div>`,[{t:'Yopish',cls:'red'}]);
  $('#bxEc').onclick=()=>{const ins=[...document.querySelectorAll('[data-e]')];if(ins.some(x=>!x.value.trim())){toast('Avval hamma bo‘sh joyni to‘ldiring');return}
    let ok=0;ins.forEach((x,i)=>{const good=e.ans[i].map(a=>a.toLowerCase()).includes(bxNorm(x.value));if(good)ok++;x.readOnly=true;x.parentNode.classList.add(good?'ok':'no');if(!good)x.value=x.value+' → '+e.ans[i][0]});
    acc.e=ok;sfx(ok>=5?'win':'complete');
    $('#bxEf').innerHTML=`<div class="bx-cfb ${ok>=5?'ok':'no'}"><b>${ok}/6 to‘g‘ri.</b> ${ok===6?'A’lo — matnni to‘liq tushundingiz!':'Qizil joylarni asl matndan toping.'}</div>`;
    const b=$('#bxEc');b.textContent='Testni yakunlash 🏁';b.onclick=()=>bxDone(t,acc)}}
/* ---------- finish: save, XP, then the final page ---------- */
function bxDone(t,acc){const S=bxS(),d=S.tests[t.id]=S.tests[t.id]||{};const first=!d.kwt;
  if(first){d.kwt={tFirst:acc.b||0,tTotal:(t.table||[]).length||8,hFirst:0,hTotal:0,at:Date.now()};if(t.extra)d.kwt.extra={c:acc.c||0,cT:6,d:acc.d||0,dT:t.extra.d.length,e:acc.e||0,eT:6};
    let gained=0;if(d.res){gained=bxp(P,d.res.score);P.xp.B+=gained;P.xp.bn++;P.xp.T+=gained;const m=(P.board||[]).find(r=>r.me);if(m)m.t=P.xp.T}
    bxSave();bxFinal(t,true,gained)}else bxFinal(t,false)}
function bxFinal(t,fresh,gained){
  const d=bxS().tests[t.id]||{},r=d.res,k=d.kwt||{},x=k.extra;ui.bxVis=null;const nx=t.id<BOOSTER_TESTS?t.id+1:null;
  view().innerHTML=`<div class="wrap bx anim">
    <div class="bx-win ${fresh?'fresh':''}"><div class="bx-trophy">🏆</div><div><small>Test ${t.id} · ${esc(t.title)}</small><h1>${fresh?'Test yakunlandi!':'Bu test bajarilgan'}</h1>
      <p>${r?`O‘qish: <b>${r.score}/6</b> · vaqt ${bxFmt(r.time)}`:''}${gained?` · <b class="xp">+${gained} XP</b>`:''}</p></div></div>
    <div class="bx-sum"><div><b>${k.tFirst||0}/${k.tTotal||8}</b><span>B · Kalit so‘zlar (1-urinish)</span></div>${x?`<div><b>${x.c}/${x.cT}</b><span>C · Bo‘sh joy turi</span></div><div><b>${x.d}/${x.dT}</b><span>D · Juftliklar</span></div><div><b>${x.e}/${x.eT}</b><span>E · Qisqa mazmun</span></div>`:''}</div>
    <div class="card sec"><h3>Mening kalit so‘zlar jadvalim</h3><p class="muted">Bu jadvalni lug‘at daftaringizga ko‘chiring.</p>
      <div class="bx-tw"><table class="bx-tbl"><thead><tr><th>#</th><th>Matnda</th><th>Ma’nosi yaqin</th><th>O‘zbekcha</th></tr></thead><tbody>${(t.table||[]).map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td class="u">${esc(r[2])}</td></tr>`).join('')}</tbody></table></div></div>
    ${t.extra?`<div class="card sec"><h3>So‘z juftliklarim</h3><div class="bx-tw"><table class="bx-tbl"><tbody>${t.extra.d.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r[0])}</b> <span class="red">${esc(r[1])}</span></td></tr>`).join('')}</tbody></table></div></div>`:''}
    <div class="bx-bar"><button class="btn ghost" id="bxAns">Javoblar</button><button class="btn ghost" id="bxAgain">Mashqlarni qayta ishlash</button>${nx?`<button class="btn red big" id="bxNext">Test ${nx} →</button>`:`<button class="btn red big" id="bxMap2">Xaritaga</button>`}</div></div>`;
  if(fresh){confetti();sfx('grand');if(gained)xpPop(gained,false)}
  $('#bxAns').onclick=()=>{if(r)bxResult(t,true)};$('#bxAgain').onclick=()=>bxB(t,{});
  const nb=$('#bxNext');if(nb)nb.onclick=()=>go('#/me/b/'+nx);const mb=$('#bxMap2');if(mb)mb.onclick=()=>go('#/me/a/'+BOOSTER_AID);
}

/* ================= START ================= */
(function start(){
  const t=sstore(ST+'t');
  if(t){U={role:'teacher',pass:t};enterApp();route();return}
  try{U=JSON.parse(store(ST+'session')||'null')}catch(e){U=null}
  if(U&&U.role==='student'&&U.id&&U.t){const exp=+String(U.t).split('.')[0]||0;
    if(!exp||exp>Date.now()){enterApp();if(!location.hash||location.hash==='#/'||location.hash.startsWith('#/login'))history.replaceState(null,'','#/me');route();return}}
  if(U){store(ST+'session',null);dropKey()}
  U=null;route();
})();
