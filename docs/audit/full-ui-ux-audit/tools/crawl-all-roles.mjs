import { chromium, request } from 'playwright';
import fs from 'node:fs';
const role = process.argv[2]; const B='http://localhost:3000', PW='Demo-Passw0rd-2026!', em=(l)=>`${l}@demo.szabmu.invalid`;
const ids=JSON.parse(fs.readFileSync('/tmp/audit-ids.json','utf8')); const axeSrc=fs.readFileSync('/tmp/axe/node_modules/axe-core/axe.min.js','utf8');
const USERS={student:'student.a004',lecturer:'lecturer.a',examiner:'examiner',cce:'cce',campus_admin:'admin.a',invigilator:'invigilator.a',super_admin:'super.admin'};
const who=USERS[role]; fs.mkdirSync(`/tmp/audit-shots/${role}`,{recursive:true});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900},baseURL:B}); const p=await ctx.newPage();
const api=await request.newContext({baseURL:B}); await api.post('/api/auth/login',{data:{email:em(who),password:PW}});
// ids that depend on the session
let resultId=null; try{const j=await (await api.get('/api/me/results')).json(); resultId=(j.items??j)[0]?.id??null;}catch{}
const routes=[['/dashboard'],['/schedule'],['/results'],['/performance'],['/profile'],['/questions'],['/exams'],['/students'],['/users'],['/institutions'],['/programs'],['/assignments'],['/enrolment'],['/monitor'],['/incidents'],['/audit'],
 [`/exams/${ids.X100}`,'exam-detail-live-100q'],[`/exams/${ids.X100}/control`,'control-live-100q'],[`/exams/${ids.XP}`,'exam-detail-published'],[`/exams/${ids.XP}/control`,'control-published'],[`/exams/${ids.XA}`,'exam-detail-awaiting-approval'],[`/exams/${ids.draft}`,'exam-detail-draft'],
 [`/monitor/${ids.X100}`,'monitor-live-100q'],[`/exam/${ids.X100}`,'player-entry-100q'],[`/exam/${ids.XP}`,'player-entry-completed']];
if(resultId) routes.push([`/certificate/${resultId}`,'certificate']); routes.push(['/certificate/00000000-0000-4000-8000-000000000000','certificate-invalid'],['/does-not-exist','not-found'],['/mfa']);
const VPS=[[360,780],[390,844],[428,926],[768,1024],[1024,768],[1280,800],[1440,900],[1600,900]];
const slug=(r)=>r.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'root';
// login through the real form
await p.goto('/login'); await p.getByLabel('University email').fill(em(who)); await p.getByLabel('Password').fill(PW); await p.getByRole('button',{name:/sign in/i}).click(); await p.waitForURL(/dashboard|mfa/,{timeout:20000});
const out=[]; let cons=[],bad=[];
p.on('console',m=>{ if(['error','warning'].includes(m.type())) cons.push(`${m.type()}: ${m.text().slice(0,200)}`); });
p.on('response',r=>{ if(r.status()>=400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(B,'')}`); });
p.on('pageerror',e=>cons.push('pageerror: '+String(e.message).slice(0,200)));
const inventory=()=>p.evaluate(()=>{
  const vis=(e)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const name=(e)=>{const a=e.getAttribute('aria-label'); if(a) return a; const lb=e.getAttribute('aria-labelledby'); if(lb) return lb.split(' ').map(i=>document.getElementById(i)?.textContent??'').join(' ').trim(); if(e.id){const l=document.querySelector(`label[for="${e.id}"]`); if(l) return l.textContent.trim();} const wl=e.closest('label'); if(wl&&e.tagName!=='BUTTON'&&e.tagName!=='A') return wl.textContent.trim(); return (e.innerText||e.getAttribute('title')||e.getAttribute('placeholder')||e.value||'').trim().replace(/\s+/g,' ');};
  const els=[...document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=tab],[role=radio],[role=checkbox],[tabindex]:not([tabindex="-1"])')].filter(vis);
  const items=els.map(e=>{const r=e.getBoundingClientRect(); return {tag:e.tagName.toLowerCase(),type:e.getAttribute('type')||'',role:e.getAttribute('role')||'',name:name(e).slice(0,80),href:e.tagName==='A'?(e.getAttribute('href')||''):'',w:Math.round(r.width),h:Math.round(r.height),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',iconOnly:!(e.innerText||'').trim(),placeholderOnly:!!e.getAttribute('placeholder')&&!e.getAttribute('aria-label')&&!(e.id&&document.querySelector(`label[for="${e.id}"]`))&&!e.closest('label'),testid:e.getAttribute('data-testid')||''};});
  const heads=[...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(h=>({l:h.tagName,t:h.textContent.trim().replace(/\s+/g,' ').slice(0,90)}));
  const lm={main:document.querySelectorAll('main,[role=main]').length,nav:document.querySelectorAll('nav,[role=navigation]').length,header:document.querySelectorAll('header,[role=banner]').length,skip:!![...document.querySelectorAll('a')].find(a=>/skip to/i.test(a.textContent))};
  const imgs=[...document.querySelectorAll('img')].filter(vis).map(i=>({alt:i.getAttribute('alt'),src:i.getAttribute('src')}));
  const tables=[...document.querySelectorAll('table')].filter(vis).map(t=>({rows:t.rows.length,th:t.querySelectorAll('th').length,caption:!!t.querySelector('caption'),scopeTh:[...t.querySelectorAll('th')].every(h=>h.getAttribute('scope'))}));
  const dupIds=[...document.querySelectorAll('[id]')].map(e=>e.id).filter((v,i,a)=>a.indexOf(v)!==i);
  const live={status:document.querySelectorAll('[role=status],[aria-live]').length,alert:document.querySelectorAll('[role=alert]').length};
  return {items,heads,lm,imgs,tables,dupIds,live,bodyText:document.body.innerText.slice(0,2500),lang:document.documentElement.lang,title:document.title};
});
for(const [route,label] of routes){
  cons=[];bad=[]; const rec={role,route,label:label||slug(route)};
  try{
    const resp=await p.goto(route,{waitUntil:'domcontentloaded'}); rec.httpStatus=resp?.status(); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(1200);
    rec.finalUrl=p.url().replace(B,''); rec.redirected=rec.finalUrl!==route;
    Object.assign(rec,await inventory());
    // keyboard: first 14 tab stops, focus visibility
    await p.evaluate(()=>document.activeElement?.blur()); const stops=[]; for(let i=0;i<14;i++){await p.keyboard.press('Tab'); stops.push(await p.evaluate(()=>{const e=document.activeElement; if(!e||e===document.body) return null; const s=getComputedStyle(e); const r=e.getBoundingClientRect(); return {tag:e.tagName.toLowerCase(),name:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('title')||'').trim().replace(/\s+/g,' ').slice(0,40),outline:s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0,shadow:s.boxShadow!=='none',inView:r.top>=0&&r.bottom<=innerHeight};}));}
    rec.tabStops=stops;
    // axe at desktop
    await p.addScriptTag({content:axeSrc}); const ax=await p.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}}); return r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.length,tags:v.tags.filter(t=>/wcag\d+$|wcag2\d*a+$/.test(t)||/^wcag\d{3,}/.test(t)).slice(0,3),sample:v.nodes.slice(0,2).map(n=>({t:n.target.join(' ').slice(0,80),h:n.html.slice(0,140),s:(n.failureSummary||'').slice(0,160)}))}));}).catch(e=>[{id:'axe-error',help:String(e.message).slice(0,100)}]);
    rec.axeDesktop=ax;
    rec.console=[...cons]; rec.failed=[...bad];
    // viewport matrix: overflow + touch targets, screenshots at 1440 / 768 / 390
    rec.viewports={};
    for(const [w,h] of [[1440,900],[768,1024],[390,844],[360,780],[428,926],[1024,768],[1280,800],[1600,900]]){
      await p.setViewportSize({width:w,height:h}); await p.waitForTimeout(350);
      const m=await p.evaluate(()=>{const vis=(e)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}; const sw=document.documentElement.scrollWidth,iw=innerWidth; const small=[...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button]')].filter(vis).filter(e=>{const r=e.getBoundingClientRect(); return r.width<24||r.height<24;}).length; const sub44=[...document.querySelectorAll('a[href],button,select,textarea,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),[role=button]')].filter(vis).filter(e=>{const r=e.getBoundingClientRect(); return r.height<44||r.width<44;}).length; const clip=[...document.querySelectorAll('body *')].filter(vis).filter(e=>{const r=e.getBoundingClientRect(); return r.right>iw+1&&getComputedStyle(e).position!=='fixed'&&!e.closest('.tbl-wrap,[style*="overflow"]');}).slice(0,4).map(e=>`${e.tagName.toLowerCase()}.${String(e.className).slice(0,30)} right=${Math.round(e.getBoundingClientRect().right)}`); const nav=getComputedStyle(document.querySelector('.sidebar')||document.body); const bodyH=document.documentElement.scrollHeight; return {sw,iw,overflow:sw>iw+1,small24:small,sub44,clip,docH:bodyH,sidebarVisible:!!document.querySelector('.sidebar')&&getComputedStyle(document.querySelector('.sidebar')).visibility!=='hidden'&&document.querySelector('.sidebar').getBoundingClientRect().right>0,menuBtn:!!document.querySelector('[data-testid=menu-button]')&&getComputedStyle(document.querySelector('[data-testid=menu-button]')).display!=='none'};});
      rec.viewports[w]=m;
      if([1440,768,390].includes(w)&&rec.httpStatus<400||[1440,768,390].includes(w)){ const f=`/tmp/audit-shots/${role}/${rec.label}-${w}.jpg`; await p.screenshot({path:f,fullPage:true,type:'jpeg',quality:68}).catch(()=>{}); (rec.shots??=[]).push(f); }
      if(w===390){ await p.addScriptTag({content:axeSrc}).catch(()=>{}); rec.axeMobile=await p.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}); return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));}).catch(()=>[]); }
    }
    await p.setViewportSize({width:1440,height:900});
  }catch(e){ rec.error=String(e.message).split('\n')[0]; }
  out.push(rec); process.stdout.write('.');
}
fs.writeFileSync(`/tmp/audit-data/${role}.json`,JSON.stringify(out,null,1)); console.log('\n',role,'routes',out.length,'errors',out.filter(r=>r.error).length);
await b.close();
