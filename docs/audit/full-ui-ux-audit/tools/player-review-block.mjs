import { chromium } from 'playwright'; import fs from 'node:fs';
const B='http://localhost:3000', PW='Demo-Passw0rd-2026!', em=(l)=>`${l}@demo.szabmu.invalid`; const ids=JSON.parse(fs.readFileSync('/tmp/audit-ids.json','utf8'));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']}); const R={};
for(const [mode,who] of [['http500','student.a029'],['hang','student.a030']]){
  const c=await b.newContext({viewport:{width:1440,height:900},baseURL:B}); const p=await c.newPage(); await p.goto('/login'); await p.getByLabel('University email').fill(em(who)); await p.getByLabel('Password').fill(PW); await p.getByRole('button',{name:/sign in/i}).click(); await p.waitForURL(/dashboard/); await p.goto(`/exam/${ids.X100}`); await p.getByRole('button',{name:/begin|resume/i}).click(); await p.getByRole('timer').waitFor();
  await p.route('**/api/attempts/*/answers/*',async(route)=>{ if(route.request().method()!=='PUT') return route.continue(); if(mode==='http500') return route.fulfill({status:500,contentType:'application/json',body:'{"code":"INTERNAL","message":"x"}'}); });
  await p.getByTestId('opt-B').click(); await p.waitForTimeout(1500);
  const btn=p.getByRole('button',{name:/review & submit/i}).first(); const t0=Date.now(); await btn.click(); const trace=[];
  for(let i=0;i<14;i++){ await p.waitForTimeout(2000); trace.push({sec:Math.round((Date.now()-t0)/1000),reviewShown:await p.getByRole('heading',{name:'Review your answers'}).count(),btnDisabled:await btn.isDisabled().catch(()=>null),msg:(await p.locator('.conn[role=status]').first().innerText().catch(()=>'')).slice(0,120),saveState:(await p.getByTestId('save-state').innerText().catch(()=>'')).trim().slice(0,40)}); if(trace.at(-1).reviewShown) break; }
  R[mode]=trace; await p.screenshot({path:`/tmp/audit-shots/player/review-click-${mode}.jpg`,type:'jpeg',quality:70}); await c.close(); }
fs.writeFileSync('/tmp/audit-data/player-review.json',JSON.stringify(R,null,1)); for(const [k,v] of Object.entries(R)){console.log(k); v.forEach(x=>console.log(' ',JSON.stringify(x)));} await b.close();
