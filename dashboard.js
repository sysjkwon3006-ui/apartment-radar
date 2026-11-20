"use strict";
/*
Apartment Radar dashboard v0.5
- Seoul 25 districts and configured Gyeonggi cities by official LAWD_CD.
- Two independent min/max price and area slider pairs.
- Source review boundary: provisional public filings are NOT independently verified.
- Four future quality dimensions have NO scores until evidenced.
*/
(()=>{
const $=id=>document.getElementById(id);
const S={registry:[],regions:[],meta:{},matches:null,history:null,discovery:null};
const ESC=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const meanMed=a=>{const s=a.slice().sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:Math.round((s[m-1]+s[m])*5000)/10000;};
const won=v=>Number.isFinite(v)?v.toLocaleString("ko-KR",{maximumFractionDigits:2})+"억":"검증 필요";
const range=a=>a.length?won(Math.min(...a))+" ~ "+won(Math.max(...a)):"표본 부족";
const regionMapping={"과천":"41290","분당":"41135","판교":"41135","수지":"41465","서초":"11650","강동":"11740","광교":"41117","동탄":"41597","강남":"11680","송파":"11710"};
const unitOK=(area,f)=>area>=f.areaMin&&area<=f.areaMax;
const availableEvidence=a=>Array.isArray(a)&&new Set(a.filter(x=>x&&x.organization&&x.url).map(x=>x.organization)).size>=2;
const approved=c=>c.verification?.status==="verified"&&c.households>=500&&availableEvidence(c.static_sources)&&availableEvidence(c.sales_sources)&&availableEvidence(c.lease_sources)&&c.verification.checked_at&&(c.sales||[]).filter(x=>x.verified===true&&x.type==="brokered"&&!x.cancelled).length>=3&&(c.leases||[]).filter(x=>x.verified===true&&x.type==="new"&&!x.cancelled).length>=3;
function filters(){return {province:$("province-filter").value,code:$("district-filter").value,priceMin:+$("price-min").value,priceMax:+$("price-max").value,areaMin:+$("area-min").value,areaMax:+$("area-max").value,sort:$("sort-filter").value};}
function regionOK(code,f){if(f.code!=="all")return code===f.code;return f.province==="seoul"?code?.startsWith("11"):code?.startsWith("41");}
function registryCode(c){return c.region_code||regionMapping[c.region]||null;}
function setDistricts(preserve=true){
 const current=$("district-filter").value;
 const province=$("province-filter").value;
 const list=S.regions.filter(x=>province==="seoul"?x.code.startsWith("11"):x.code.startsWith("41"));
 const select=$("district-filter");
 select.innerHTML='<option value="all">'+(province==="seoul"?"서울 전체 (25개 구)":"경기 남부 전체")+'</option>'+
 list.slice().sort((a,b)=>a.name.localeCompare(b.name,"ko")).map(x=>'<option value="'+ESC(x.code)+'">'+ESC(x.name.replace(/^서울\s*/, "").replace(/^경기\s*/, ""))+'</option>').join("");
 select.value=preserve&&list.some(x=>x.code===current)?current:"all";
}
function syncSlider(type,source){
 const lo=$(type+"-min"),hi=$(type+"-max");
 let a=+lo.value,b=+hi.value;
 if(a>b){if(source==="min"){hi.value=String(a);b=a;}else{lo.value=String(b);a=b;}}
 const bounds={price:{min:5,max:50,unit:"억원",short:"억"},area:{min:59,max:165,unit:"㎡",short:"㎡"}}[type];
 $(type+"-label").textContent=a+" ~ "+b+bounds.unit;
 $(type+"-min-output").textContent=a+bounds.short;
 $(type+"-max-output").textContent=b+bounds.short;
 const left=100*(a-bounds.min)/(bounds.max-bounds.min),right=100*(bounds.max-b)/(bounds.max-bounds.min);
 const fill=$(type+"-fill");fill.style.left=left+"%";fill.style.right=right+"%";
 if(source){(source==="min"?lo:hi).style.zIndex="3";(source==="min"?hi:lo).style.zIndex="2";}
}
function currentRegionLabel(f){if(f.code==="all")return f.province==="seoul"?"서울 전체":"경기 남부 전체";return S.regions.find(x=>x.code===f.code)?.name||f.code;}
function saleT(t){return t.method==="brokered"&&!t.cancelled&&Number.isFinite(t.price_100m);}
function leaseT(t){return t.lease_type==="new"&&t.rent_category==="jeonse"&&Number.isFinite(t.deposit_100m);}
function candidateUnits(){
 const byID=new Map();
 for(const g of S.matches?.candidate_groups||[])byID.set(g.complex_id,{group:g,units:new Map(g.units.map(u=>[String(u.registered_area_m2),u]))});
 for(const h of S.history?.units||[]){
  if(!byID.has(h.complex_id))byID.set(h.complex_id,{group:{complex_id:h.complex_id,region:h.region,neighborhood:h.neighborhood},units:new Map()});
  const item=byID.get(h.complex_id);
  if(!item.units.has(String(h.registered_area_m2)))item.units.set(String(h.registered_area_m2),{registered_area_m2:h.registered_area_m2,sales:[],new_jeonse:[]});
 }
 const results=[];
 const cutoff=new Date();cutoff.setFullYear(cutoff.getFullYear()-1);
 const since=cutoff.toISOString().slice(0,10);
 for(const [id,obj] of byID){
  const c=S.registry.find(r=>r.id===id);if(!c||!(c.households>=500))continue;
  for(const [key,u] of obj.units){
   const h=S.history?.units?.find(t=>t.complex_id===id&&String(t.registered_area_m2)===key);
   const rows=h?h.sales.filter(t=>saleT(t)&&t.date>=since).map(t=>({...t,contract_date:t.date})): (u.sales||[]).filter(t=>t.match_reason==="exact_lot_area_name"&&saleT(t));
   const rents=h?h.new_jeonse.filter(leaseT).map(t=>({...t,contract_date:t.date})):(u.new_jeonse||[]).filter(t=>t.match_reason==="exact_lot_area_name"&&leaseT(t));
   const sales=rows.sort((a,b)=>b.contract_date.localeCompare(a.contract_date)).slice(0,5);
   const leases=rents.sort((a,b)=>b.contract_date.localeCompare(a.contract_date)).slice(0,5);
   const median=meanMed(sales.map(t=>t.price_100m));
   results.push({id,complex:c,region:registryCode(c),area:u.registered_area_m2,sales,leases,median,date:sales[0]?.contract_date||"",history:h||null});
  }
 }
 return results;
}
function sortCandidates(rows,how){
 return rows.sort((a,b)=>{
  if(how==="recent")return (b.date||"").localeCompare(a.date||"")||b.sales.length-a.sales.length;
  if(how==="cheapest")return (a.median??Infinity)-(b.median??Infinity)||b.sales.length-a.sales.length;
  return b.sales.length-a.sales.length||(b.date||"").localeCompare(a.date||"");
 });
}
function candidateCard(x,num,full){
 const ratio=x.sales.length&&x.leases.length?100*meanMed(x.leases.map(t=>t.deposit_100m))/x.median:null;
 return '<article class="complex-card trial-card">'+
 '<div class="card-head"><span class="pill warning">'+(full?"국토부 1차 참고":"실거래 표본 부족")+'</span><small>'+(full?"비교 "+num:"순위 없음")+'</small></div>'+
 '<h3>'+ESC(x.complex.name)+' <span class="trial-area">'+ESC(x.area)+'㎡</span></h3>'+
 '<p>'+ESC(x.complex.neighborhood||"")+" · "+ESC(x.complex.households)+'세대 (정적정보 재검증 대기)</p>'+
 '<div class="trial-price">'+range(x.sales.map(t=>t.price_100m))+'</div>'+
 '<p>중개 신고 '+x.sales.length+'건'+(x.date?" · 최신 "+ESC(x.date):"")+'</p>'+
 '<p>신규 전세 '+x.leases.length+'건 · '+(ratio!==null?"참고 전세가율 "+ratio.toFixed(1)+"%":"전세가율 미산정")+'</p>'+
 '<div class="card-foot"><small>독립 2차 확인 전</small><button type="button" class="text-btn" data-candidate="'+ESC(x.id)+'" data-unit="'+ESC(x.area)+'">거래내역 보기 →</button></div></article>';
}
function approvedCard(c){
 return '<article class="complex-card"><span class="pill">검증 완료</span><h3>'+ESC(c.name)+'</h3><p>'+ESC(c.address||"")+'</p><div class="meta"><span>'+ESC(c.households)+'세대</span><span>승인일 '+ESC(c.verification.checked_at)+'</span></div><div class="card-foot"><small>건별 독립 확인 완료</small><button class="text-btn" data-approved="'+ESC(c.id)+'">상세 보기 →</button></div></article>';
}
function renderVerified(f){
 const list=S.registry.filter(c=>{
  if(!approved(c)||!regionOK(registryCode(c),f))return false;
  const units=(c.types||[]).filter(t=>t.status==="verified"&&unitOK(t.area_m2,f));
  if(!units.length)return false;
  const s=(c.sales||[]).filter(t=>t.verified===true&&t.type==="brokered"&&!t.cancelled).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(t=>t.price_100m);
  return s.length>=3&&meanMed(s)>=f.priceMin&&meanMed(s)<=f.priceMax&&Math.max(...s)<=f.priceMax;
 });
 $("top-count").textContent=list.length;
 $("top-title").textContent=currentRegionLabel(f)+" · 교차검증 완료 단지";
 $("top-results").innerHTML=list.length?'<div class="cards">'+list.slice(0,5).map(approvedCard).join("")+'</div>':'<div class="empty"><strong>이 조건에서 독립 2차 검증 완료 단지가 아직 없어.</strong><p>아래 국토부 1차 비교와 지역 확장 후보를 참고하되, 확정 추천으로 해석하지 말아줘.</p></div>';
}
function renderCandidates(f){
 const all=candidateUnits().filter(x=>regionOK(x.region,f)&&unitOK(x.area,f));
 const priceOK=x=>x.median!==null&&x.median>=f.priceMin&&x.median<=f.priceMax&&x.sales.every(s=>s.price_100m<=f.priceMax);
 const best=sortCandidates(all.filter(x=>x.sales.length>=3&&priceOK(x)),f.sort);
 const low=sortCandidates(all.filter(x=>x.sales.length>0&&x.sales.length<3&&priceOK(x)),f.sort);
 const missing=all.filter(x=>!x.sales.length);
 const n=best.slice(0,5);
 $("preview-count").textContent=n.length+"개";
 $("preview-top").innerHTML=n.length?'<div class="cards">'+n.map((x,i)=>candidateCard(x,i+1,true)).join("")+'</div>':'<div class="empty"><strong>이 범위에 중개거래 3건 이상인 1차 후보가 없어.</strong><p>다른 가격이나 면적 범위를 선택하거나 표본 부족 목록을 살펴봐줘.</p></div>';
 $("preview-lower-count").textContent=(low.length+missing.length)+"개";
 const lesser=[...low.slice(0,8),...missing.slice(0,8)];
 $("preview-lower").innerHTML=lesser.length?'<div class="cards">'+lesser.map(x=>candidateCard(x,"",false)).join("")+'</div>':'<div class="empty">추가 조사 후보가 아직 없습니다.</div>';
 $("preview-source-date").textContent=(S.history?"최근 12개월 계약 중 마지막 5건 · 24개월 과거 신고 데이터 사용":"최근 3개월 1차 신고 · 24개월 이력 확보 전")+" · 독립 2차 검증은 별도";
}
function renderPending(f){
 const q=S.registry.filter(c=>!approved(c)&&regionOK(registryCode(c),f)&&(c.types||[]).some(t=>unitOK(t.area_m2,f)));
 $("pending-count").textContent=q.length+"개";
 $("pending-results").innerHTML=q.length?q.slice(0,18).map(c=>'<article class="complex-card"><span class="pill warning">검증 대기</span><h3>'+ESC(c.name)+'</h3><p>'+ESC(c.address||"주소 확인 필요")+'</p><div class="meta"><span>'+ESC(c.households??"—")+'세대(등록 정보)</span><span>'+ESC((c.types||[]).filter(t=>unitOK(t.area_m2,f)).map(t=>t.area_m2).join(", "))+'㎡</span></div></article>').join(""):'<div class="empty">해당 지역·면적의 등록 단지가 없습니다. 아래 지역 발굴 자료를 확인해줘.</div>';
}
function renderDiscovery(f){
 const box=$("discovery-results"),note=$("discovery-status");
 if(!S.discovery){
  $("discovery-count").textContent="수집 준비 중";
  box.innerHTML='<div class="empty"><strong>새로운 지역의 후보를 수집하는 단계야.</strong><p>서울 전체·경기 남부 지역을 데이터 수집 대상으로 등록했어. 확장 수집 후 단지별 결과가 표시돼.</p></div>';
  note.textContent="기존 신고자료가 없는 구는 후보가 0개라고 판단하지 않아.";
  return;
 }
 const arr=(S.discovery.entries||[]).filter(x=>regionOK(x.region_code,f)&&unitOK(x.area_m2,f)&&x.sale_median>=f.priceMin&&x.sale_median<=f.priceMax&&x.sale_max<=f.priceMax);
 arr.sort((a,b)=>f.sort==="recent"?b.latest_sale_date.localeCompare(a.latest_sale_date):f.sort==="cheapest"?a.sale_median-b.sale_median:b.sale_count_all_in_period-a.sale_count_all_in_period);
 const sample=arr.slice(0,30);
 $("discovery-count").textContent=arr.length+"개 발견";
 box.innerHTML=sample.length?'<div class="discovery-table-wrap"><table class="discovery-table"><thead><tr><th>신고 단지명</th><th>법정동·지번</th><th>전용면적</th><th class="numeric">최근 중개 매매</th><th class="numeric">거래 건수</th><th>상태</th></tr></thead><tbody>'+
 sample.map(x=>'<tr><td>'+ESC(x.apartment_name)+'</td><td>'+ESC(x.legal_dong)+" "+ESC(x.jibun)+'</td><td>'+ESC(x.area_m2)+'㎡</td><td class="numeric">'+won(x.sale_median)+'</td><td class="numeric">'+ESC(x.sale_count_all_in_period)+'건</td><td><span class="note-pill">500세대·2차 검증 전</span></td></tr>').join("")+'</tbody></table></div>':
 '<div class="empty">선택한 구·매수가·전용면적에 해당하는 1차 탐색 후보가 없어. 수집 기간과 단지 등록 범위를 확인해줘.</div>';
 note.textContent="현재 확보한 데이터 기준 · 총 "+(S.discovery.candidate_unit_count||0)+"개 세부타입 · 확대된 47개 구 중 기존 조회 범위에 거래 신고가 있는 구만 표시됨 · TOP5 추천과 별개";
}
function render(){
 if(!S.regions.length)return;
 const f=filters();
 $("filter-summary").textContent=currentRegionLabel(f)+" · "+f.priceMin+"~"+f.priceMax+"억원 · "+f.areaMin+"~"+f.areaMax+"㎡ · 현재는 "+$("sort-filter").selectedOptions[0].text;
 $("total-count").textContent=S.registry.length;
 $("verified-count").textContent=S.registry.filter(approved).length;
 $("last-verified").textContent=S.meta.last_verified_at||"아직 없음";
 $("status-text").textContent=(S.meta.message||"공공 자료 조회 상태 확인 중")+" · 확정 시세와 1차 신고는 분리";
 renderVerified(f);renderCandidates(f);renderPending(f);renderDiscovery(f);
 $("detail").hidden=true;
 $("trial-detail").hidden=true;
}
function table(rows,field){
 if(!rows.length)return'<p class="subtext">신고 표본 없음</p>';
 return'<table class="tx-table"><thead><tr><th>계약일</th><th>층</th><th>면적</th><th>금액</th></tr></thead><tbody>'+
 rows.map(x=>'<tr><td>'+ESC(x.contract_date||x.date)+'</td><td>'+ESC(x.floor??"—")+'</td><td>'+ESC(x.area_m2)+'㎡</td><td>'+won(x[field])+'</td></tr>').join("")+'</tbody></table>';
}
function chart(pts){
 if(!pts.length)return'<div class="empty-chart">확보한 신고 거래점이 없습니다.</div>';
 const groups=new Map();
 for(const x of pts){const date=x.contract_date||x.date;const month=date.slice(0,7);const arr=groups.get(month)||[];arr.push(x.price_100m);groups.set(month,arr);}
 const points=[...groups].map(([month,values])=>({month,median:meanMed(values),count:values.length}));
 const vs=points.map(x=>x.median),min=Math.floor(Math.min(...vs)-1),max=Math.ceil(Math.max(...vs)+1),scale=Math.max(max-min,1);
 const now=new Date(),nowIdx=now.getFullYear()*12+now.getMonth(),w=660,h=210;
 const marks=points.map(pt=>{const [y,m]=pt.month.split("-").map(Number);const ago=nowIdx-(y*12+m-1);if(ago<0||ago>23)return"";const cx=43+(23-ago)/23*570,cy=25+(max-pt.median)/scale*158;
 return'<circle cx="'+cx.toFixed(2)+'" cy="'+cy.toFixed(2)+'" r="5.5" fill="#2465ad"><title>'+ESC(pt.month)+": "+ESC(pt.median)+"억 ("+ESC(pt.count)+"건)</title></circle>";}).join("");
 return'<svg role="img" aria-label="최근 24개월 거래가 있는 달만 찍은 산점도. 빈 달 보간 없음" viewBox="0 0 660 210" width="100%"><line x1="43" y1="183" x2="613" y2="183" stroke="#b9c8da"/><text x="2" y="30" fill="#64748b" font-size="11">'+max+'억</text><text x="2" y="183" fill="#64748b" font-size="11">'+min+'억</text>'+marks+'</svg>';
}
function trialDetail(id,area){
 const x=candidateUnits().find(x=>x.id===id&&String(x.area)===String(area));if(!x)return;
 const sales=x.sales,leases=x.leases;const hist=x.history?.sales?.filter(saleT).map(y=>({...y,contract_date:y.date}))||sales;
 const ratio=sales.length&&leases.length?100*meanMed(leases.map(y=>y.deposit_100m))/x.median:null;
 $("trial-detail-title").textContent=x.complex.name+" · 전용 "+x.area+"㎡";
 $("trial-detail-body").innerHTML='<div class="trial-alert"><strong>국토부 1차 신고자료 — 독립 2차 검증 전</strong><p>유사 단지와 혼동하지 않도록 지번·면적·신고명을 확인한 후 사용하세요. 거래지연·정정 가능성이 있어요.</p></div>'+
 '<div class="detail-grid"><div class="detail-box"><h3>등록 단지정보 (2차 확인 대기)</h3><dl><dt>주소</dt><dd>'+ESC(x.complex.address||"—")+'</dd><dt>지번</dt><dd>'+ESC(x.complex.lot_address||"—")+'</dd><dt>세대수</dt><dd>'+ESC(x.complex.households??"—")+'</dd><dt>준공연도</dt><dd>'+ESC(x.complex.built_year??"—")+'</dd></dl></div>'+
 '<div class="detail-box"><h3>최근 실거래 표본</h3><dl><dt>중개 매매 3~5건</dt><dd>'+range(sales.map(y=>y.price_100m))+'</dd><dt>신규 전세</dt><dd>'+range(leases.map(y=>y.deposit_100m))+'</dd><dt>참고 전세가율</dt><dd>'+(ratio===null?"산출 보류":ratio.toFixed(1)+"%")+'</dd><dt>관심·적정·추격가격</dt><dd>2차 교차검증 전 미산정</dd></dl></div>'+
 '<div class="detail-box"><h3>매매 계약일·층·가격</h3>'+table(sales,"price_100m")+'</div>'+
 '<div class="detail-box"><h3>신규 전세 계약일·층·가격</h3>'+table(leases,"deposit_100m")+'</div>'+
 '<div class="detail-box"><h3>24개월 공공 신고 추세</h3>'+chart(hist)+'<p class="subtext">'+(x.history?"24개월 수집 원장 기반, 독립 대조 전.":"최근 3개월 신고만 확보. 24개월 복원 전.")+" 월별 중앙값은 자료가 있는 달만 표시했어.</p></div>"+
 '<div class="detail-box"><h3>장기 평가 점수</h3><p>급지·장기 가치: 미산정</p><p>가격 매력도: 미산정</p><p>동탄 출퇴근: 출입구·출근시각 경로 미확보</p><p>실거주 편의: 생활시설·경사·관리 검증 필요</p><p>현재는 1차 신고표본 비교일 뿐 투자 적정가를 계산하지 않아.</p></div></div>';
 $("trial-detail").hidden=false;$("trial-detail").scrollIntoView({behavior:"smooth",block:"start"});
}
function reset(){
 $("province-filter").value="gyeonggi";setDistricts(false);$("district-filter").value="41135";
 [["price",20,30],["area",100,135]].forEach(([type,a,b])=>{$(type+"-min").value=a;$(type+"-max").value=b;syncSlider(type);});
 $("sort-filter").value="sample";render();
}
function setup(){
 $("province-filter").addEventListener("change",()=>{setDistricts(false);render();});
 $("district-filter").addEventListener("change",render);
 $("sort-filter").addEventListener("change",render);
 for(const type of ["price","area"]){for(const side of ["min","max"]){$(type+"-"+side).addEventListener("input",()=>{syncSlider(type,side);render();});}}
 $("reset-btn").addEventListener("click",reset);
 $("close-detail").addEventListener("click",()=>$("detail").hidden=true);
 document.addEventListener("click",e=>{
  const el=e.target.closest("[data-candidate]");if(el)trialDetail(el.dataset.candidate,el.dataset.unit);
  if(e.target.closest("#trial-close"))$("trial-detail").hidden=true;
 });
}
async function fetchJSON(path,optional=false){
 try{const r=await fetch(path,{cache:"no-store"});if(!r.ok)throw Error(r.status+" "+path);return await r.json();}
 catch(e){if(optional)return null;throw e;}
}
async function start(){
 setup();
 const [region,registry,meta,matches,history,discovery]=await Promise.all([
  fetchJSON("./data/regions.json"),fetchJSON("./data/complexes.json"),fetchJSON("./data/site-meta.json"),
  fetchJSON("./data/matches/latest.json",true),fetchJSON("./data/history/latest.json",true),fetchJSON("./data/discovery/summary.json",true)
 ]);
 S.regions=region.regions;S.registry=registry.complexes;S.meta=meta;S.matches=matches;S.history=history;S.discovery=discovery;
 reset();
}
start().catch(e=>{console.error(e);$("status-text").textContent="데이터 로드 실패. GitHub 파일·배포를 확인하세요.";$("preview-top").innerHTML='<div class="empty">데이터 로드 오류. 새로고침 후 재시도해줘.</div>';});
})();