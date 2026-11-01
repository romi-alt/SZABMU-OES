import { chromium, request } from 'playwright';
import fs from 'node:fs';
const B='http://localhost:3000', PW='Demo-Passw0rd-2026!', em=(l)=>`${l}@demo.szabmu.invalid`;
const ids=JSON.parse(fs.readFileSync('/tmp/audit-ids.json','utf8')); fs.mkdirSync('/tmp/audit-shots/player',{recursive:true});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const R={}; const shot=async(p,n,full=false)=>{await p.waitForTimeout(500); await p.screenshot({path:`/tmp/audit-shots/player/${n}.jpg`,type:'jpeg',quality:70,fullPage:full});};
const box=async(p,sel)=>{const l=p.locator(sel).first(); if(!(await l.count())) return null; const bb=await l.boundingBox(); return bb&&{x:Math.round(bb.x),y:Math.round(bb.y),w:Math.round(bb.width),h:Math.round(bb.height)};};
const inView=(bb,vh,vw)=>!!bb&&bb.y>=0&&bb.y+bb.h<=vh&&bb.x>=0&&bb.x+bb.w<=vw;
async function login(p,who){await p.goto('/login'); await p.getByLabel('University email').fill(em(who)); await p.getByLabel('Password').fill(PW); await p.getByRole('button',{name:/sign in/i}).click(); await p.waitForURL(/dashboard/);}
async function enter(p,examId){await p.goto(`/exam/${examId}`); await p.getByRole('button',{name:/begin examination/i}).click(); await p.getByRole('timer').waitFor({timeout:20000}); await p.waitForTimeout(600);}
async function measure(tag,who,vp,examId,{mobile=false,dsf=1}={}){
  const out={tag,who,vp,exam:examId===ids.X100?'100q':'longtext'};
  const c=await b.newContext({viewport:vp,deviceScaleFactor:dsf,isMobile:mobile,hasTouch:mobile,baseURL:B}); const p=await c.newPage(); const reqs=[];
  p.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/attempts')) reqs.push(r.method()+' '+r.url().replace(B,'').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g,'<id>'));});
  await login(p,who); await enter(p,examId);
  const vw=vp.width,vh=vp.height;
  // first screen
  await shot(p,`${tag}-01-first-screen`);
  out.first={timer:await box(p,'[role=timer]'),submit:await box(p,'button:has-text("Review & submit")'),palette:await box(p,'#question-navigator, aside[aria-label="Question navigator"]'),optionA:await box(p,'[data-testid=opt-A]'),saveNext:await box(p,'button:has-text("Save & next")'),skip:await box(p,'button:has-text("Skip question")'),next:await box(p,'button:has-text("Next")')};
  out.first.inView=Object.fromEntries(Object.entries(out.first).map(([k,v])=>[k,inView(v,vh,vw)]));
  out.palette={buttons:await p.locator('.pal button').count(),firstScreenVisible:await p.locator('.pal button').evaluateAll((els,[vh,vw])=>els.filter(e=>{const r=e.getBoundingClientRect(); return r.top>=0&&r.bottom<=vh&&r.left>=0&&r.right<=vw&&getComputedStyle(e).visibility!=='hidden'&&e.offsetParent!==null;}).length,[vh,vw]),btnSize:await p.locator('.pal button').first().boundingBox().then(b=>b&&[Math.round(b.width),Math.round(b.height)]).catch(()=>null),roles:await p.locator('.pal button').first().getAttribute('role'),paletteBox:await box(p,'.pal')};
  out.docHeight=await p.evaluate(()=>document.documentElement.scrollHeight);
  await shot(p,`${tag}-02-full-page`,true);
  // sticky behaviour: scroll to the bottom
  await p.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight)); await p.waitForTimeout(300);
  out.afterScrollBottom={timerVisible:inView(await box(p,'[role=timer]'),vh,vw),submitVisible:inView(await box(p,'button:has-text("Review & submit")'),vh,vw),paletteAnyVisible:await p.locator('.pal button').evaluateAll((els,[vh])=>els.filter(e=>{const r=e.getBoundingClientRect(); return r.top>=0&&r.bottom<=vh&&e.offsetParent!==null;}).length,[vh]),saveNextVisible:inView(await box(p,'button:has-text("Save & next")'),vh,vw)};
  await shot(p,`${tag}-03-scrolled-bottom`); await p.evaluate(()=>window.scrollTo(0,0));
  // answer + save indicator timing
  const t0=Date.now(); await p.getByTestId('opt-C').click(); const early=await p.getByTestId('save-state').innerText(); await p.getByTestId('save-state').filter({hasText:'Saved'}).waitFor({timeout:8000}).catch(()=>{}); out.save={textRightAfterClick:early.trim(),msToSaved:Date.now()-t0,afterText:(await p.getByTestId('save-state').innerText()).trim(),reqs:[...new Set(reqs)].slice(0,6)};
  // Next vs Skip semantics: q1 answered; go Next (q2 untouched) then Next again; skip q3
  await p.getByRole('button',{name:/^Next/}).click(); await p.waitForTimeout(300); await p.getByRole('button',{name:/^Next/}).click(); await p.waitForTimeout(300); // visited q2 unanswered, now q3
  await p.getByRole('button',{name:'Skip question'}).click(); await p.waitForTimeout(400); // skipped q3, now q4
  const states=async()=>p.locator('.pal button').evaluateAll(els=>els.slice(0,6).map(e=>e.getAttribute('aria-label')));
  out.paletteStatesAfterNextNextSkip=await states();
  // Mark + Clear response without confirmation
  await p.getByTestId('opt-B').click(); await p.waitForTimeout(500); await p.getByRole('button',{name:'Mark for review'}).click(); await p.waitForTimeout(300);
  const before=await p.getByTestId('opt-B').getAttribute('aria-checked'); await p.getByRole('button',{name:'Clear response'}).click(); await p.waitForTimeout(500);
  out.clear={checkedBefore:before,checkedAfter:await p.getByTestId('opt-B').getAttribute('aria-checked'),dialogShown:await p.getByRole('dialog').count(),toast:await p.locator('.toast').count()};
  await shot(p,`${tag}-04-after-clear`);
  // jump to a far question and count interactions
  const last=(await p.locator('.pal button').count()); const target=Math.min(87,last);
  let steps=0; const tb=p.locator('.pal button').nth(target-1);
  if(mobile||vw<=960){ await p.getByTestId('palette-toggle').click(); steps++; }
  const vis=async()=>inView(await tb.boundingBox().then(b=>b&&{x:b.x,y:b.y,w:b.width,h:b.height}),vh,vw);
  let scrolls=0; while(!(await vis())&&scrolls<12){ await p.mouse.wheel(0,300); scrolls++; await p.waitForTimeout(120);} 
  await tb.click(); steps++; await p.waitForTimeout(500);
  out.jump={target,paletteToggle:(mobile||vw<=960)?1:0,scrollsNeeded:scrolls,clicks:steps,scrollsAndClicks:steps+scrolls,landedOn:(await p.locator('.q-head span').first().innerText().catch(()=>'?')).trim()};
  await shot(p,`${tag}-05-after-jump-${target}`);
  // filter chips on palette
  out.chips=await p.locator('.chip').allInnerTexts().catch(()=>[]);
  // offline behaviour
  await c.setOffline(true); await p.waitForTimeout(500);
  const optBefore=await p.getByTestId('opt-D').count(); if(optBefore){ await p.getByTestId('opt-D').click().catch(()=>{}); await p.waitForTimeout(1500);} 
  out.offline={banner:(await p.locator('.conn.off').first().innerText().catch(()=>'(none)')).slice(0,220),saveState:(await p.getByTestId('save-state').innerText().catch(()=>'')).trim(),reviewBtnEnabled:await p.getByRole('button',{name:/review & submit/i}).first().isEnabled()};
  await shot(p,`${tag}-06-offline`);
  await c.setOffline(false); await p.waitForTimeout(6000); out.reconnected={banner:await p.locator('.conn.off').count(),saveState:(await p.getByTestId('save-state').innerText().catch(()=>'')).trim()};
  await shot(p,`${tag}-07-reconnected`);
  // review screen
  await p.getByRole('button',{name:/review & submit/i}).first().click(); await p.getByRole('heading',{name:'Review your answers'}).waitFor({timeout:15000}); await p.waitForTimeout(500);
  out.review={text:(await p.locator('.exam-body').innerText()).replace(/\s+/g,' ').slice(0,420),submitBtn:await box(p,'button:has-text("Submit examination")'),palette:await box(p,'.pal')};
  await shot(p,`${tag}-08-review`,true);
  await p.getByRole('button',{name:/Submit examination/}).click(); await p.waitForTimeout(400);
  out.confirm={text:(await p.getByRole('dialog').innerText()).replace(/\s+/g,' ').slice(0,260),confirmDisabledUntilTick:await p.getByRole('button',{name:'Confirm and submit'}).isDisabled()}; await shot(p,`${tag}-09-confirm`,false);
  await p.getByRole('button',{name:'Cancel'}).click().catch(()=>{});
  R[tag]=out; await c.close();
}
const cfg=process.argv[2];
if(cfg==='desktop'){ await measure('d1440','student.a010',{width:1440,height:900},ids.X100); await measure('d1024','student.a011',{width:1024,height:700},ids.X100); await measure('zoom200','student.a012',{width:640,height:360},ids.X100,{dsf:2}); }
if(cfg==='small'){ await measure('t768','student.a013',{width:768,height:1024},ids.X100,{mobile:true,dsf:2}); await measure('p390','student.a014',{width:390,height:844},ids.X100,{mobile:true,dsf:2}); await measure('p360','student.a015',{width:360,height:640},ids.X100,{mobile:true,dsf:2}); }
if(cfg==='long'){ await measure('long-d1440','student.a016',{width:1440,height:900},ids.X200); await measure('long-p390','student.a017',{width:390,height:844},ids.X200,{mobile:true,dsf:2}); }
fs.writeFileSync(`/tmp/audit-data/player-${cfg}.json`,JSON.stringify(R,null,1)); console.log(cfg,'done',Object.keys(R)); await b.close();
