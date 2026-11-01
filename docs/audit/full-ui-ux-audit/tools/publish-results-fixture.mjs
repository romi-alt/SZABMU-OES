import { chromium, request } from 'playwright';
import fs from 'node:fs';
const B='http://localhost:3000', PW='Demo-Passw0rd-2026!', em=(l)=>`${l}@demo.szabmu.invalid`;
const {XP,keys}=JSON.parse(fs.readFileSync('/tmp/audit-ids.json','utf8'));
const api=async(l)=>{const r=await request.newContext({baseURL:B}); const x=await r.post('/api/auth/login',{data:{email:em(l),password:PW}}); if(!x.ok()) throw new Error('login '+l); return r;};
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
async function sit(who,howMany){
  const c=await b.newContext({viewport:{width:1280,height:800},baseURL:B}); const p=await c.newPage();
  await p.goto('/login'); await p.getByLabel('University email').fill(em(who)); await p.getByLabel('Password').fill(PW); await p.getByRole('button',{name:/sign in/i}).click(); await p.waitForURL(/dashboard/);
  await p.goto(`/exam/${XP}`); await p.getByRole('button',{name:/begin examination/i}).click(); await p.getByRole('timer').waitFor();
  for(let i=0;i<8;i++){
    const stem=(await p.locator('.q-stem').first().innerText()).trim(); const right=keys[stem]; 
    if(!right) console.log('no key for',stem.slice(0,50));
    const pick = i<howMany ? right : ('ABCDE'.replace(right,'')[0]);
    await p.getByTestId(`opt-${pick}`).click(); await p.getByTestId('save-state').filter({hasText:'Saved'}).waitFor({timeout:8000}).catch(()=>{});
    if(i<7) await p.getByRole('button',{name:/^Next/}).click();
  }
  await p.getByRole('button',{name:/review & submit/i}).first().click(); await p.getByRole('heading',{name:'Review your answers'}).waitFor();
  await p.getByRole('button',{name:/Submit examination/}).click(); await p.getByRole('dialog').getByRole('checkbox').check(); await p.getByRole('button',{name:'Confirm and submit'}).click(); await p.getByTestId('receipt-code').waitFor({timeout:30000});
  await c.close();
}
await sit('student.a002',8); await sit('student.a003',4); await sit('student.b002',6);
await b.close();
const cce=await api('cce'), lect=await api('lecturer.a'), examiner=await api('examiner');
const log=async(n,r)=>console.log(n,r.status(),r.ok()?'':(await r.text()).slice(0,140));
await log('close',await cce.post(`/api/exams/${XP}/control/close`,{data:{force:true,reason:'Audit fixture: close completed paper'}}));
await new Promise(r=>setTimeout(r,6000));
await log('scoring',await cce.post(`/api/exams/${XP}/control/initiate-scoring`,{data:{}}));
for(let i=0;i<25;i++){const r=await (await cce.get(`/api/results/exams/${XP}`)).json(); if(r.batch?.status==='GRADED') break; await new Promise(r=>setTimeout(r,2000));}
await log('lecturer review',await lect.post(`/api/grading/exams/${XP}/review`,{data:{note:'Reviewed'}}));
await log('approve',await examiner.post(`/api/results/exams/${XP}/approve`,{data:{}}));
await log('publish',await cce.post(`/api/results/exams/${XP}/publish`,{data:{}}));
const r=await (await cce.get(`/api/results/exams/${XP}`)).json(); console.log('batch',r.batch?.status,'results',(r.items??r.results??[]).length);
