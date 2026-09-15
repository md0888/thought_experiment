(() => {
  'use strict';

  const KEY = 'idea_lab_v01_ideas';
  const SETTINGS_KEY = 'idea_lab_v01_settings';
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const nowIso = () => new Date().toISOString();

  const stopwords = new Set('그 이 저 것 수 등 더 때 중 좀 매우 정말 그냥 그리고 하지만 또는 대한 있는 없는 하는 했다 하면 해서 나는 내가 우리 제가 제게 것이 처럼 때문 생각 아이디어 그런 이런 여기 거기 어떻게 왜 무엇 어떤 혹시 있다 없다 되다 된다 하고 입니다 있어요 같아 같다 아닐까 만약 또한 통해 위해 가장 서로 이미 다시'.split(/\s+/));
  const categoryRules = {
    '콘텐츠': ['이야기','스토리','캐릭터','그림','웹툰','동화','원고','영상','애니메이션','책','콘텐츠','장면','대사'],
    '교육': ['아이','아동','교육','학습','부모','학교','교사','질문','성장','품성','독서'],
    '기술': ['ai','인공지능','앱','웹','자동화','코드','데이터','vr','ar','에이전트','모델','시스템','기술'],
    '사업': ['사업','시장','고객','수익','가격','판매','제안','지원사업','브랜드','투자','서비스','제품'],
    '연구': ['가설','실험','원인','차이','비교','연구','검증','관찰','왜','원리','분석'],
    '생활': ['집','가족','건강','시간','일상','습관','여행','식사','운동']
  };

  let state = {
    ideas: loadIdeas(),
    settings: loadSettings(),
    currentId: null,
    recognition: null,
    recording: false,
    finalTranscript: '',
    installPrompt: null
  };

  function loadIdeas(){
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }
  function saveIdeas(){ localStorage.setItem(KEY, JSON.stringify(state.ideas)); }
  function loadSettings(){
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{"lang":"ko-KR","aiEndpoint":"","aiToken":""}'); }
    catch { return {lang:'ko-KR', aiEndpoint:'', aiToken:''}; }
  }
  function saveSettings(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }
  function uid(){ return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
  function escapeHtml(s=''){ return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function compact(s=''){ return s.replace(/\s+/g,' ').trim(); }
  function sentences(text=''){ return compact(text).split(/(?<=[.!?。？！]|다\.|요\.)\s+|\n+/).map(s=>s.trim()).filter(Boolean); }
  function titleFrom(text){
    const first = sentences(text)[0] || compact(text) || '새로운 생각';
    return first.length > 34 ? first.slice(0,34).trim() + '…' : first;
  }
  function tokens(text=''){
    return compact(text.toLowerCase()).replace(/[^0-9a-zA-Z가-힣\s]/g,' ').split(/\s+/).filter(w => w.length > 1 && !stopwords.has(w));
  }
  function keywords(text, max=5){
    const freq = new Map();
    tokens(text).forEach(w => freq.set(w,(freq.get(w)||0)+1));
    return [...freq.entries()].sort((a,b)=>b[1]-a[1] || b[0].length-a[0].length).slice(0,max).map(([w])=>w);
  }
  function categoryFor(text){
    const low = text.toLowerCase();
    let best = ['미분류',0];
    Object.entries(categoryRules).forEach(([cat, list])=>{
      const score = list.reduce((n,k)=>n+(low.includes(k)?1:0),0);
      if(score>best[1]) best=[cat,score];
    });
    return best[0];
  }
  function summaryFor(text){
    const ss = sentences(text);
    if(!ss.length) return '';
    if(ss.length === 1) return ss[0].slice(0,120);
    const ks = keywords(text,6);
    const scored = ss.map((s,i)=>({s,i,score:ks.reduce((n,k)=>n+(s.includes(k)?2:0),0)+(i===0?2:0)}));
    scored.sort((a,b)=>b.score-a.score || a.i-b.i);
    return scored.slice(0,2).sort((a,b)=>a.i-b.i).map(x=>x.s).join(' ').slice(0,220);
  }
  function promptsFor(text, ks){
    const key = ks[0] || '이 생각';
    const hasWhy = /왜|원인|때문|이유/.test(text);
    const hasCompare = /차이|다른|비교|반대|유사/.test(text);
    const p = [];
    p.push(hasWhy ? `지금 떠올린 원인 말고, ${key}을 설명할 수 있는 다른 원인은 무엇일까?` : `${key}이 사실이라면 반드시 함께 관찰되어야 할 현상은 무엇일까?`);
    p.push(hasCompare ? `가장 비슷해 보이지만 실제로는 다른 사례를 하나 고른다면 무엇일까?` : `정반대 사례를 찾아도 이 생각은 여전히 성립할까?`);
    p.push(`이 생각을 오늘 10분 안에 확인한다면, 가장 작은 실험은 무엇일까?`);
    p.push(`이 아이디어를 어린이에게 한 문장으로 설명한다면 어떻게 말할까?`);
    return p;
  }
  function hypothesisFor(text, ks){
    const key = ks[0] || '이 현상';
    if(/아닐까|일까|가설|만약/.test(text)) return `가설: ${summaryFor(text)}`;
    return `가설: ${key}에는 아직 드러나지 않은 원인이나 규칙이 있을 수 있다.`;
  }
  function experimentFor(ks){
    const key = ks[0] || '핵심 현상';
    return `${key}과 관련된 사례 3개와 반례 1개를 찾아, 공통점·차이점을 한 줄씩 적어본다.`;
  }
  function similarity(a,b){
    const A = new Set(tokens(`${a.title} ${a.raw} ${(a.tags||[]).join(' ')}`));
    const B = new Set(tokens(`${b.title} ${b.raw} ${(b.tags||[]).join(' ')}`));
    if(!A.size || !B.size) return 0;
    let inter=0; A.forEach(x=>{if(B.has(x)) inter++;});
    const union = new Set([...A,...B]).size;
    return inter/union;
  }
  function relatedTo(idea, limit=4){
    return state.ideas.filter(x=>x.id!==idea.id).map(x=>({idea:x,score:similarity(idea,x)})).filter(x=>x.score>0.04).sort((a,b)=>b.score-a.score).slice(0,limit);
  }
  function processIdea(raw){
    const ks = keywords(raw,5);
    return {
      id: uid(), createdAt: nowIso(), updatedAt: nowIso(), raw: raw.trim(),
      title: titleFrom(raw), summary: summaryFor(raw), tags: ks,
      category: categoryFor(raw), status:'seed', favorite:false,
      hypothesis: hypothesisFor(raw,ks), experiment:experimentFor(ks),
      prompts:promptsFor(raw,ks), notes:'', conclusion:'', aiResult:''
    };
  }
  function fmtDate(iso){
    const d = new Date(iso); return new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
  }
  function statusLabel(s){ return ({seed:'씨앗',growing:'발전 중',action:'실행 후보'})[s] || '씨앗'; }
  function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),1700); }

  function showView(name){
    $$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));
    $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.target===name));
    if(name==='ideas') renderIdeas();
    if(name==='connect') renderConnections();
    if(name==='capture') renderDashboard();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function renderDashboard(){
    const n=state.ideas.length, fav=state.ideas.filter(x=>x.favorite).length, act=state.ideas.filter(x=>x.status==='action').length;
    $('#miniStats').innerHTML=`<div class="stat"><b>${n}</b><span>쌓인 생각</span></div><div class="stat"><b>${fav}</b><span>즐겨찾기</span></div><div class="stat"><b>${act}</b><span>실행 후보</span></div>`;
    const card=$('#resurfaceCard');
    if(n){
      const sorted=[...state.ideas].sort((a,b)=>new Date(a.updatedAt)-new Date(b.updatedAt));
      const pool=sorted.slice(0,Math.max(1,Math.ceil(sorted.length*.5)));
      const day = Math.floor(Date.now()/86400000);
      const idea=pool[day%pool.length];
      state.resurfaceId=idea.id; $('#resurfaceTitle').textContent=idea.title; $('#resurfaceSummary').textContent=idea.summary; card.hidden=false;
    } else card.hidden=true;
  }

  function renderIdeas(){
    const q=$('#searchInput').value.trim().toLowerCase(); const filter=$('#filterSelect').value;
    let ideas=[...state.ideas].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    if(q) ideas=ideas.filter(x=>`${x.title} ${x.raw} ${x.summary} ${(x.tags||[]).join(' ')}`.toLowerCase().includes(q));
    if(filter==='favorite') ideas=ideas.filter(x=>x.favorite); else if(filter!=='all') ideas=ideas.filter(x=>x.status===filter);
    const list=$('#ideaList');
    if(!ideas.length){ list.innerHTML=`<div class="empty-state">아직 조건에 맞는 생각이 없습니다.<br>첫 아이디어를 말해보세요.</div>`; return; }
    list.innerHTML=ideas.map(x=>`<article class="idea-card" data-id="${x.id}">
      <button class="star ${x.favorite?'on':''}" data-star="${x.id}" aria-label="즐겨찾기">★</button>
      <h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.summary)}</p>
      <div class="idea-meta"><span class="badge accent">${escapeHtml(x.category)}</span><span class="badge">${statusLabel(x.status)}</span><span class="badge">${fmtDate(x.updatedAt)}</span></div>
    </article>`).join('');
    $$('.idea-card').forEach(card=>card.addEventListener('click',e=>{ if(e.target.closest('.star'))return; openDetail(card.dataset.id); }));
    $$('[data-star]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();toggleFavorite(b.dataset.star);renderIdeas();}));
  }

  function openDetail(id){ state.currentId=id; renderDetail(); showView('detail'); }
  function renderDetail(){
    const x=state.ideas.find(i=>i.id===state.currentId); if(!x)return showView('ideas');
    const rel=relatedTo(x);
    $('#detailContent').innerHTML=`<article class="detail-card">
      <div class="detail-title-row"><div><div class="eyebrow">${escapeHtml(x.category)} · ${fmtDate(x.createdAt)}</div><h2>${escapeHtml(x.title)}</h2></div><button class="star ${x.favorite?'on':''}" id="detailStar">★</button></div>
      <div class="idea-meta" style="margin-top:12px">${(x.tags||[]).map(t=>`<span class="badge">#${escapeHtml(t)}</span>`).join('')}</div>
      <div class="detail-section"><h3>원래 생각</h3><div class="raw">${escapeHtml(x.raw)}</div></div>
      <div class="detail-section"><h3>2단계 · 자동 정리</h3><div class="prompt"><b>핵심</b><br>${escapeHtml(x.summary)}</div><div class="prompt" style="margin-top:8px"><b>${escapeHtml(x.hypothesis)}</b></div></div>
      <div class="detail-section"><h3>3단계 · 사고 실험 질문</h3><div class="prompt-list">${x.prompts.map((p,i)=>`<div class="prompt"><b>${i+1}.</b> ${escapeHtml(p)}</div>`).join('')}</div></div>
      <div class="detail-section"><h3>가장 작은 검증</h3><div class="prompt">${escapeHtml(x.experiment)}</div></div>
      <div class="detail-section"><h3>내 생각 이어쓰기</h3><textarea id="notesBox" class="edit-box" rows="5" placeholder="질문에 답하거나, 새로 떠오른 생각을 적으세요.">${escapeHtml(x.notes||'')}</textarea><textarea id="conclusionBox" class="edit-box" rows="3" placeholder="지금 단계의 결론 또는 다음 행동">${escapeHtml(x.conclusion||'')}</textarea></div>
      <div class="detail-section"><h3>4단계 · 연결된 생각</h3><div class="related-list">${rel.length?rel.map(r=>`<button class="related-btn" data-related="${r.idea.id}">${escapeHtml(r.idea.title)}<br><small>${Math.round(r.score*100)}% 유사</small></button>`).join(''):'<div class="help">아직 충분히 비슷한 생각이 없습니다.</div>'}</div></div>
      ${x.aiResult?`<div class="detail-section"><h3>AI 심화 결과</h3><div class="ai-result">${escapeHtml(x.aiResult)}</div></div>`:''}
      <div class="detail-actions"><button class="btn primary" id="saveDetailBtn">저장</button><button class="btn secondary" id="growBtn">발전 중으로</button><button class="btn secondary" id="actionBtn">실행 후보로</button><button class="btn secondary" id="aiDeepBtn">AI 심화</button><button class="btn danger" id="deleteBtn">삭제</button></div>
    </article>`;
    $('#detailStar').addEventListener('click',()=>{toggleFavorite(x.id);renderDetail();});
    $('#saveDetailBtn').addEventListener('click',()=>saveDetail(x));
    $('#growBtn').addEventListener('click',()=>{x.status='growing';x.updatedAt=nowIso();saveIdeas();renderDetail();toast('발전 중으로 표시했습니다.');});
    $('#actionBtn').addEventListener('click',()=>{x.status='action';x.updatedAt=nowIso();saveIdeas();renderDetail();toast('실행 후보로 표시했습니다.');});
    $('#deleteBtn').addEventListener('click',()=>{ if(confirm('이 생각을 삭제할까요?')){state.ideas=state.ideas.filter(i=>i.id!==x.id);saveIdeas();showView('ideas');toast('삭제했습니다.');}});
    $('#aiDeepBtn').addEventListener('click',()=>callAiForIdea(x));
    $$('[data-related]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.related)));
  }
  function saveDetail(x){ x.notes=$('#notesBox').value.trim(); x.conclusion=$('#conclusionBox').value.trim(); x.updatedAt=nowIso(); saveIdeas(); toast('저장했습니다.'); }
  function toggleFavorite(id){ const x=state.ideas.find(i=>i.id===id); if(x){x.favorite=!x.favorite;x.updatedAt=nowIso();saveIdeas();} }

  function renderConnections(){
    const svg=$('#ideaGraph'), empty=$('#graphEmpty'), list=$('#connectionList');
    const ideas=state.ideas.slice(-14); svg.innerHTML=''; list.innerHTML='';
    if(ideas.length<2){empty.hidden=false;return;} empty.hidden=true;
    const pairs=[]; for(let i=0;i<ideas.length;i++)for(let j=i+1;j<ideas.length;j++){const s=similarity(ideas[i],ideas[j]);if(s>0.04)pairs.push({a:ideas[i],b:ideas[j],s});}
    const W=720,H=460,cx=W/2,cy=H/2,rx=275,ry=165;
    const pos={}; ideas.forEach((x,i)=>{const a=(Math.PI*2*i/ideas.length)-Math.PI/2;pos[x.id]={x:cx+Math.cos(a)*rx,y:cy+Math.sin(a)*ry};});
    pairs.sort((a,b)=>b.s-a.s).slice(0,24).forEach(p=>{const l=document.createElementNS('http://www.w3.org/2000/svg','line');l.setAttribute('x1',pos[p.a.id].x);l.setAttribute('y1',pos[p.a.id].y);l.setAttribute('x2',pos[p.b.id].x);l.setAttribute('y2',pos[p.b.id].y);l.setAttribute('class','graph-line');l.setAttribute('opacity',Math.min(.85,.25+p.s*2));svg.appendChild(l);});
    ideas.forEach((x)=>{const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.style.cursor='pointer';g.addEventListener('click',()=>openDetail(x.id));const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',pos[x.id].x);c.setAttribute('cy',pos[x.id].y);c.setAttribute('r',x.favorite?28:24);c.setAttribute('class',`graph-node ${x.favorite?'favorite':''}`);g.appendChild(c);const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',pos[x.id].x);t.setAttribute('y',pos[x.id].y+43);t.setAttribute('class','graph-label');t.textContent=x.title.length>14?x.title.slice(0,14)+'…':x.title;g.appendChild(t);const s=document.createElementNS('http://www.w3.org/2000/svg','text');s.setAttribute('x',pos[x.id].x);s.setAttribute('y',pos[x.id].y+56);s.setAttribute('class','graph-sub');s.textContent=x.category;g.appendChild(s);svg.appendChild(g);});
    const top=pairs.sort((a,b)=>b.s-a.s).slice(0,6); list.innerHTML=top.length?top.map(p=>`<div class="connection-item"><b>${escapeHtml(p.a.title)} ↔ ${escapeHtml(p.b.title)}</b><p>${Math.round(p.s*100)}% 유사 · 공통 키워드와 문맥을 기준으로 연결</p></div>`).join(''):'<div class="empty-state">서로 다른 생각들이 쌓이고 있습니다. 아직 강한 연결은 없습니다.</div>';
  }

  function setupSpeech(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ $('#micStatus').textContent='이 브라우저는 음성 인식을 지원하지 않습니다.'; $('#micBtn').disabled=true; return; }
    const r=new SR(); r.lang=state.settings.lang||'ko-KR'; r.continuous=true; r.interimResults=true;
    r.onstart=()=>{state.recording=true;$('#micBtn').classList.add('recording');$('#micBtn .mic-label').textContent='말하는 중…';$('#micStatus').textContent='말을 멈추면 자동으로 정리됩니다.';state.finalTranscript=$('#ideaInput').value.trim();};
    r.onresult=(e)=>{let interim='',finalAdd='';for(let i=e.resultIndex;i<e.results.length;i++){const tx=e.results[i][0].transcript;if(e.results[i].isFinal)finalAdd+=tx+' ';else interim+=tx;}if(finalAdd)state.finalTranscript=compact(`${state.finalTranscript} ${finalAdd}`);$('#ideaInput').value=compact(`${state.finalTranscript} ${interim}`);};
    r.onerror=(e)=>{ if(e.error!=='no-speech') toast(`음성 인식: ${e.error}`); };
    r.onend=()=>{state.recording=false;$('#micBtn').classList.remove('recording');$('#micBtn .mic-label').textContent='눌러서 말하기';$('#micStatus').textContent=$('#ideaInput').value.trim()?'기록 완료 · 저장하면 자동으로 발전시킵니다.':'대기 중';};
    state.recognition=r;
  }
  function toggleSpeech(){
    if(!state.recognition)return;
    if(state.recording){state.recognition.stop();}else{state.recognition.lang=state.settings.lang||'ko-KR';try{state.recognition.start();}catch{}}
  }

  function addIdea(){
    const raw=$('#ideaInput').value.trim(); if(!raw){toast('먼저 생각을 말하거나 적어주세요.');return;}
    const x=processIdea(raw); state.ideas.push(x); saveIdeas(); $('#ideaInput').value=''; state.finalTranscript=''; renderDashboard(); openDetail(x.id); toast('생각을 붙잡았습니다.');
  }

  function exportData(){
    const blob=new Blob([JSON.stringify({version:'0.1',exportedAt:nowIso(),ideas:state.ideas,settings:{lang:state.settings.lang}},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`idea-lab-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importData(file){
    try{const data=JSON.parse(await file.text());if(!Array.isArray(data.ideas))throw new Error('잘못된 형식');if(state.ideas.length && !confirm('현재 아이디어를 가져온 백업으로 교체할까요?'))return;state.ideas=data.ideas;saveIdeas();renderDashboard();toast('백업을 복원했습니다.');}
    catch(e){toast('백업 파일을 읽지 못했습니다.');}
  }

  async function callAiForIdea(x){
    const endpoint=(state.settings.aiEndpoint||'').trim();
    if(!endpoint){
      x.aiResult = `아직 외부 AI가 연결되지 않았습니다.\n\n로컬 가이드가 권하는 다음 단계:\n1) 반례를 1개 찾기\n2) 사례를 3개 비교하기\n3) 오늘 가능한 최소 실험 실행하기\n4) 결론을 한 문장으로 적기`;
      saveIdeas();renderDetail();toast('로컬 심화 가이드를 만들었습니다.');return;
    }
    const btn=$('#aiDeepBtn');btn.disabled=true;btn.textContent='분석 중…';
    try{
      const headers={'Content-Type':'application/json'}; if(state.settings.aiToken)headers['Authorization']=`Bearer ${state.settings.aiToken}`;
      const rel=relatedTo(x,3).map(r=>({title:r.idea.title,summary:r.idea.summary,score:r.score}));
      const res=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({app:'idea-lab',version:'0.1',idea:x,related:rel})});
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      x.aiResult = data.result || data.analysis || data.text || JSON.stringify(data,null,2); x.updatedAt=nowIso();saveIdeas();renderDetail();toast('AI 심화 분석을 받았습니다.');
    }catch(e){toast(`AI 연결 실패: ${e.message}`);btn.disabled=false;btn.textContent='AI 심화';}
  }

  async function testAi(){
    const endpoint=$('#aiEndpoint').value.trim(); const out=$('#aiTestResult'); if(!endpoint){out.textContent='URL을 입력하면 연결을 테스트할 수 있습니다.';return;}
    out.textContent='연결 확인 중…';
    try{const headers={'Content-Type':'application/json'};const token=$('#aiToken').value.trim();if(token)headers.Authorization=`Bearer ${token}`;const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({type:'ping',app:'idea-lab',message:'connection test'})});out.textContent=r.ok?'연결되었습니다.':'서버가 응답했지만 오류가 있습니다: '+r.status;}
    catch(e){out.textContent='연결 실패: '+e.message;}
  }

  function bind(){
    $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.target)));
    $('#micBtn').addEventListener('click',toggleSpeech);$('#saveIdeaBtn').addEventListener('click',addIdea);$('#clearInputBtn').addEventListener('click',()=>{$('#ideaInput').value='';state.finalTranscript='';});
    $('#searchInput').addEventListener('input',renderIdeas);$('#filterSelect').addEventListener('change',renderIdeas);$('#exportBtn').addEventListener('click',exportData);$('#backToIdeasBtn').addEventListener('click',()=>showView('ideas'));
    $('#openResurfaceBtn').addEventListener('click',()=>openDetail(state.resurfaceId));
    $('#langSelect').value=state.settings.lang||'ko-KR';$('#aiEndpoint').value=state.settings.aiEndpoint||'';$('#aiToken').value=state.settings.aiToken||'';
    $('#saveSettingsBtn').addEventListener('click',()=>{state.settings.lang=$('#langSelect').value;state.settings.aiEndpoint=$('#aiEndpoint').value.trim();state.settings.aiToken=$('#aiToken').value.trim();saveSettings();if(state.recognition)state.recognition.lang=state.settings.lang;toast('설정을 저장했습니다.');});
    $('#testAiBtn').addEventListener('click',testAi);$('#importBtn').addEventListener('click',()=>$('#importFile').click());$('#importFile').addEventListener('change',e=>{if(e.target.files[0])importData(e.target.files[0]);});
    $('#resetBtn').addEventListener('click',()=>{if(confirm('모든 아이디어를 삭제할까요? 먼저 백업을 권합니다.')){state.ideas=[];saveIdeas();renderDashboard();toast('초기화했습니다.');}});
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('#installBtn').hidden=false;});
    $('#installBtn').addEventListener('click',async()=>{if(!state.installPrompt)return;state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$('#installBtn').hidden=true;});
  }

  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
  bind(); setupSpeech(); renderDashboard();
})();
