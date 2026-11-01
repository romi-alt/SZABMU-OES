import { request } from 'playwright';
import fs from 'node:fs';
const B='http://localhost:3000', PW='Demo-Passw0rd-2026!', em=(l)=>`${l}@demo.szabmu.invalid`;
const api=async(l)=>{const r=await request.newContext({baseURL:B}); const x=await r.post('/api/auth/login',{data:{email:em(l),password:PW}}); if(!x.ok()) throw new Error('login '+l+' '+x.status()); return r;};
const lect=await api('lecturer.a'), examiner=await api('examiner'), cce=await api('cce');
const courses=await (await examiner.get('/api/courses')).json(); const course=(courses.items??courses).find(c=>c.code==='MBBS-PATH-4');
const il=await (await examiner.get('/api/institutions')).json(); const insts=(il.items??il); const ids=insts.filter(i=>['DMC-A','DMC-B'].includes(i.code)).map(i=>i.id); const idA=insts.find(i=>i.code==='DMC-A').id;
const topics=['thyroid disease','renal tubular acidosis','granulomatous inflammation','acute myeloid leukaemia','hepatocellular carcinoma','glomerulonephritis','myocardial infarction','iron-deficiency anaemia','Hashimoto thyroiditis','cirrhosis','pulmonary embolism','sickle cell disease'];
const long='A 54-year-old man presents to the emergency department with a three-week history of progressive exertional dyspnoea, orthopnoea, bilateral ankle swelling and unintentional weight loss of 6 kg. He has a 30 pack-year smoking history, type 2 diabetes controlled on metformin, and takes no other regular medication. On examination he is afebrile, pulse 104 beats per minute irregularly irregular, blood pressure 118/74 mmHg, respiratory rate 22 per minute, oxygen saturation 93% on room air. Jugular venous pressure is raised 6 cm above the sternal angle, there are bibasal crackles, and a soft pansystolic murmur at the apex. Investigations show haemoglobin 9.8 g/dL, MCV 74 fL, ferritin 11 ng/mL, creatinine 1.6 mg/dL, and an elevated B-type natriuretic peptide. Chest radiography shows cardiomegaly and bilateral pleural effusions. '.repeat(3);
const longOpt='This option is deliberately very long to test how the examination player wraps lengthy answer text across several lines on narrow screens, including medical terminology such as hypoalbuminaemia, thrombocytopenia and hepatosplenomegaly in a single choice; ';
const keys={}; const made=[];
for(let i=1;i<=110;i++){
  const kind=i<=100?'normal':(i<=105?'longVignette':'longOptions'); const correct='ABCDE'[i%5];
  const body={courseId:course.id,type:'MCQ',stem:`Question ${i}: which finding is most characteristic of ${topics[i%topics.length]}?`,difficulty:['EASY','MEDIUM','HARD'][i%3],
    vignette: kind==='longVignette'?long:(i%4===0?`A ${20+i%50}-year-old patient presents with symptoms suggestive of ${topics[i%topics.length]}.`:undefined),
    options:'ABCDE'.split('').map((l)=>({label:l,text:kind==='longOptions'?`${l}. ${longOpt.repeat(2)}`:`Option ${l} for question ${i}`,isCorrect:l===correct}))};
  const r=await lect.post('/api/questions',{data:body}); if(!r.ok()){console.log('create fail',i,r.status(),(await r.text()).slice(0,160)); continue;}
  const q=await r.json(); made.push(q.id); keys[body.stem]=correct;
  const s=await lect.post(`/api/questions/${q.id}/submit`,{data:{}}); if(!s.ok()) console.log('submit fail',i,s.status(),(await s.text()).slice(0,120));
  const a=await examiner.post(`/api/questions/${q.id}/review`,{data:{decision:'APPROVE',note:'ok'}}); if(!a.ok()) console.log('approve fail',i,a.status(),(await a.text()).slice(0,120));
}
console.log('questions made',made.length);
const mkExam=async(title,qids,opts={})=>{
  const e=await (await examiner.post('/api/exams',{data:{code:`AU-${Date.now()%1e7}${Math.floor(Math.random()*99)}`,title,courseId:course.id,term:'2026-SPRING',opensAt:new Date(Date.now()+3600e3).toISOString(),closesAt:new Date(Date.now()+86400e3).toISOString(),durationMin:opts.dur??180,passPercent:50,negativeMarking:0,shuffleQuestions:false,institutionIds:ids,controlMode:'MANUAL',timingPolicy:'INDIVIDUAL'}})).json();
  await examiner.put(`/api/exams/${e.id}/paper`,{data:{items:qids.map(questionId=>({questionId,marks:1}))}}); await examiner.post(`/api/exams/${e.id}/paper/submit`,{data:{}});
  await cce.post(`/api/exams/${e.id}/paper/review`,{data:{decision:'APPROVE',note:'ok'}}); await examiner.post(`/api/exams/${e.id}/schedule`,{data:{}}); await cce.post(`/api/exams/${e.id}/control/policy`,{data:{suspendTimePolicy:'FREEZE_CLOCK'}}); return e.id;
};
const X100=await mkExam('Audit — 100-question Pathology Paper',made.slice(0,100));
await cce.post(`/api/exams/${X100}/control/open-admission`,{data:{}}); await cce.post(`/api/exams/${X100}/control/start`,{data:{}});
const X200=await mkExam('Audit — Long-text Paper (vignettes and long options)',made.slice(100,110),{dur:60});
await cce.post(`/api/exams/${X200}/control/open-admission`,{data:{}}); await cce.post(`/api/exams/${X200}/control/start`,{data:{}});
const XP=await mkExam('Audit — Completed Paper (published)',made.slice(0,8),{dur:30});
const XD=await mkExam('Audit — Draft Paper (no paper yet)',[]).catch(()=>null);
// a draft exam without paper
const draft=await (await examiner.post('/api/exams',{data:{code:`DR-${Date.now()%1e7}`,title:'Audit — Draft Paper (no questions yet)',courseId:course.id,term:'2026-SPRING',opensAt:new Date(Date.now()+7200e3).toISOString(),closesAt:new Date(Date.now()+90000e3).toISOString(),durationMin:60,passPercent:50,negativeMarking:0,shuffleQuestions:true,institutionIds:ids}})).json();
const XA=await (async()=>{const e=await (await examiner.post('/api/exams',{data:{code:`AP-${Date.now()%1e7}`,title:'Audit — Paper awaiting approval',courseId:course.id,term:'2026-SPRING',opensAt:new Date(Date.now()+7200e3).toISOString(),closesAt:new Date(Date.now()+90000e3).toISOString(),durationMin:60,passPercent:50,negativeMarking:0,shuffleQuestions:true,institutionIds:ids}})).json(); await examiner.put(`/api/exams/${e.id}/paper`,{data:{items:made.slice(0,5).map(questionId=>({questionId,marks:1}))}}); await examiner.post(`/api/exams/${e.id}/paper/submit`,{data:{}}); return e.id;})();
await cce.post(`/api/exams/${XP}/control/open-admission`,{data:{}}); await cce.post(`/api/exams/${XP}/control/start`,{data:{}});
fs.writeFileSync('/tmp/audit-ids.json',JSON.stringify({X100,X200,XP,XA,draft:draft.id,course:course.id,idA,keys},null,1));
console.log(JSON.stringify({X100,X200,XP,XA,draft:draft.id}));
