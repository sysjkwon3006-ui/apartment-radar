"use strict";
/* First-source preview only: never label anything as independently verified. */
(() => {
const $=id=>document.getElementById(id);
const S={queue:null,complexes:[],history:null};
const esc=v=>String(v??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const fmt=n=>Number.isFinite(n)?n.toLocaleString("ko-KR",{maximumFractionDigits:2})+"억":"미확인";
const med=arr=>{if(!arr.length)return null;const s=arr.slice().sort((a,b)=>a-b);return s.length%2?s[Math.floor(s.length/2)]:(s[s.length/2-1]+s[s.length/2])/2;};
const range=a=>a.length?fmt(Math.min(...a))+" ~ "+fmt(Math.max(...a)):"표본 없음";
const buckets={"10-15-84":[10,15,80,90],"15-20-84":[15,20,80,90],"20-30-84":[20,30,80,90],"20-30-large":[20,30,100,135]};
const areaMatch=(g,c,a)=>a==="all"||a===g.region||a===g.neighborhood||a===c.neighborhood||a===c.district||(c.tags||[]).includes(a);
const nameOK=t=>t.match_reason==="exact_lot_area_name";
const broker=t=>t.record_kind==="sale"&&t.method==="brokered"&&!t.cancelled&&nameOK(t)&&Number.isFinite(t.price_100m);
const newLease=t=>t.record_kind==="rent"&&t.lease_type==="new"&&t.rent_category==="jeonse"&&nameOK(t)&&Number.isFinite(t.deposit_100m);
function candidate(c,g,u,b){
 const sales=(u.sales||[]).filter(broker).sort((a,b)=>b.contract_date.localeCompare(a.contract_date)).slice(0,5);
 const leases=(u.new_jeonse||[]).filter(newLease).sort((a,b)=>b.contract_date.localeCompare(a.contract_date)).slice(0,5);
 const median=med(sales.map(x=>x.price_100m));
 const priceOK=median!==null&&median>=b[0]&&median<=b[1]&&sales.every(t=>t.price_100m<=b[1]);
 return {c,g,u,sales,leases,median,priceOK,date:sales[0]?.contract_date??"",valid:sales.length>=3&&priceOK};
}
function card(x,n,full){
 const c=x.c,u=x.u,sales=x.sales,leases=x.leases;
 const ratio=sales.length&&leases.length?100*med(leases.map(t=>t.deposit_100m))/med(sales.map(t=>t.price_100m)):null;
 return '<article class="complex-card trial-card"><div class="card-head"><span class="pill warning">'+(full?"국토부 1차 비교":"표본 부족 · 1차 자료")+'</span><small>'+(full?"잠정 후보 "+(n+1):"순위 없음")+'</small></div>'+
 '<h3>'+esc(c.name)+' <span class="trial-area">'+esc(u.registered_area_m2)+'㎡</span></h3>'+
 '<p>'+esc(x.g.region+" · "+x.g.neighborhood)+' · '+esc(c.households??"—")+'세대 (단지정보 검증 대기)</p>'+
 '<div class="trial-price">'+(sales.length?range(sales.map(t=>t.price_100m)):"매매 신고 미확인")+'</div>'+
 '<p>같은 타입 중개 신고 '+sales.length+'건'+(x.date?" · 최신 "+esc(x.date):"")+'</p>'+
 '<p>신규 전세 '+leases.length+'건'+(ratio!==null?" · 참고 전세가율 "+ratio.toFixed(1)+"%":" · 전세가율 미산정")+'</p>'+
 '<div class="card-foot"><small>2차 독립 검증 미완료</small><button type="button" class="text-btn" data-preview-id="'+esc(x.g.complex_id)+'" data-preview-area="'+esc(u.registered_area_m2)+'">신고 내역 보기 →</button></div></article>';
}
function render(){
 if(!S.queue)return;
 const area=$("area-filter")?.value||"all",b=buckets[$("budget-filter")?.value]||buckets["20-30-large"];
 let full=[],low=[],unknown=[];
 for(const g of S.queue.candidate_groups||[]){
  const c=S.complexes.find(t=>t.id===g.complex_id);
  if(!c||!areaMatch(g,c,area)||!(c.households>=500))continue;
  for(const u of g.units||[]){
   if(u.registered_area_m2<b[2]||u.registered_area_m2>b[3])continue;
   const x=candidate(c,g,u,b);
   if(x.valid)full.push(x);
   else if(x.priceOK&&x.sales.length)low.push(x);
   else if(!x.sales.length)unknown.push(x);
  }
 }
 const sorter=(a,b)=>b.sales.length-a.sales.length||b.date.localeCompare(a.date);
 full.sort(sorter);low.sort(sorter);unknown.sort((a,b)=>a.c.name.localeCompare(b.c.name,"ko"));
 const shown=full.slice(0,5);
 $("preview-count").textContent=shown.length+"개";
 $("preview-top").innerHTML=shown.length?'<div class="cards">'+shown.map((x,i)=>card(x,i,true)).join("")+'</div>':
 '<div class="empty"><strong>조건에 맞는 3건 이상 1차 거래 후보가 없습니다.</strong><p>아래에서 1~2건 신고 후보 및 가격 미확인 단지를 별도로 볼 수 있어요.</p></div>';
 $("preview-lower-count").textContent=(low.length+unknown.length)+"개";
 const lower=[...low.slice(0,8),...unknown.slice(0,8)];
 $("preview-lower").innerHTML=lower.length?'<div class="cards">'+lower.map((x,i)=>card(x,i,false)).join("")+'</div>':
 '<div class="empty"><strong>추가 조사 후보 없음</strong><p>해당 지역·면적의 실거래 표본이 제한적입니다.</p></div>';
 $("preview-source-date").textContent="국토부 신고 수집: "+(S.queue.underlying_molit_run||"—").slice(0,10)+" · 최근 3개월 · 독립 2차 검증 전";
}
function txTable(rows,kind){
 if(!rows.length)return'<p class="subtext">해당 종류의 1차 신고 없음</p>';
 return '<table class="tx-table"><thead><tr><th>계약일</th><th>층</th><th>신고명</th><th>금액</th></tr></thead><tbody>'+
 rows.map(r=>'<tr><td>'+esc(r.contract_date)+'</td><td>'+esc(r.floor??"—")+'</td><td>'+esc(r.apartment_name)+'</td><td>'+fmt(kind==="sale"?r.price_100m:r.deposit_100m)+'</td></tr>').join("")+'</tbody></table>';
}
function plot(rows){
 if(!rows.length)return'<div class="empty-chart">중개 매매 신고점이 없습니다.</div>';
 const groups=new Map();
 for(const r of rows){const month=r.contract_date.slice(0,7),v=groups.get(month)||[];v.push(r.price_100m);groups.set(month,v);}
 const pts=[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([month,prices])=>({month,p:med(prices),count:prices.length}));
 const values=pts.map(x=>x.p),lo=Math.floor(Math.min(...values)-1),hi=Math.ceil(Math.max(...values)+1),w=680,h=220,pad=40;
 const now=new Date(),nowIdx=now.getFullYear()*12+now.getMonth();
 const marks=pts.map(pt=>{const parts=pt.month.split("-").map(Number),monthsAgo=nowIdx-(parts[0]*12+parts[1]-1);if(monthsAgo<0||monthsAgo>23)return"";const x=pad+(23-monthsAgo)/23*(w-2*pad),y=pad+(hi-pt.p)/(hi-lo)*(h-2*pad);return'<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="6" fill="#2266b2"><title>'+esc(pt.month)+': '+esc(pt.p)+'억 · '+esc(pt.count)+'건</title></circle>';}).join("");
 return'<svg viewBox="0 0 680 220" width="100%" role="img" aria-label="24개월 틀에서 확보된 최근 3개월 신고점만 표시, 빈 달 보간 없음"><line x1="40" y1="180" x2="640" y2="180" stroke="#c4d0df"/><text x="3" y="40" font-size="12" fill="#657992">'+hi+'억</text><text x="3" y="180" font-size="12" fill="#657992">'+lo+'억</text>'+marks+'</svg>';
}
function detail(id,area){
 const g=S.queue.candidate_groups.find(x=>x.complex_id===id);if(!g)return;
 const u=g.units.find(x=>String(x.registered_area_m2)===String(area));if(!u)return;
 const c=S.complexes.find(x=>x.id===id),s=(u.sales||[]).filter(broker).sort((a,b)=>b.contract_date.localeCompare(a.contract_date)).slice(0,5),l=(u.new_jeonse||[]).filter(newLease).sort((a,b)=>b.contract_date.localeCompare(a.contract_date)).slice(0,5);
 const ratio=s.length&&l.length?100*med(l.map(x=>x.deposit_100m))/med(s.map(x=>x.price_100m)):null;
 const historyUnit=S.history?.units?.find(x=>x.complex_id===id&&String(x.registered_area_m2)===String(area));
 const historyRows=historyUnit?historyUnit.sales.filter(x=>x.method==="brokered"&&!x.cancelled).map(x=>({contract_date:x.date,price_100m:x.price_100m})):s;
 const historyTitle=historyUnit?"24개월 국토부 신고 월별 중앙값":"24개월 관찰 창 (최근 3개월만 확보)";
 const historyNote=historyUnit?"24개월 공공 신고를 수집했지만 독립 2차 출처의 건별 검증은 아직 없습니다. 빈 달은 집계 기준에 맞는 거래점이 표시되지 않은 달입니다.":"전체 24개월 자료는 아직 수집되지 않았습니다. 빈 달은 미확보 구간입니다.";
 $("trial-detail-title").textContent=c.name+" · "+area+"㎡";
 $("trial-detail-body").innerHTML='<div class="trial-alert"><b>국토부 1차 자료 · 독립 교차검증 전</b><p>전체 24개월 자료가 아닌 최근 3개월 신고 중 이름·지번·타입이 일치한 거래입니다. 신고 지연·정정에 유의하세요.</p></div>'+
 '<div class="detail-grid"><div class="detail-box"><h3>단지 등록정보 · 검증 대기</h3><dl><dt>주소</dt><dd>'+esc(c.address||"확인 필요")+'</dd><dt>지번</dt><dd>'+esc(c.lot_address||"확인 필요")+'</dd><dt>세대수</dt><dd>'+esc(c.households??"—")+'</dd><dt>준공</dt><dd>'+esc(c.built_year??"—")+'</dd></dl></div>'+
 '<div class="detail-box"><h3>1차 신고가격</h3><dl><dt>중개매매</dt><dd>'+range(s.map(x=>x.price_100m))+'</dd><dt>매매 표본</dt><dd>'+s.length+'건</dd><dt>신규 전세</dt><dd>'+range(l.map(x=>x.deposit_100m))+'</dd><dt>전세 표본</dt><dd>'+l.length+'건</dd><dt>참고 전세가율</dt><dd>'+(ratio!==null?ratio.toFixed(1)+'%':"미산정")+'</dd><dt>관심·적정·추격가격</dt><dd>2차 검증 전 보류</dd></dl></div>'+
 '<div class="detail-box"><h3>중개매매 신고</h3>'+txTable(s,"sale")+'</div><div class="detail-box"><h3>신규 전세 신고</h3>'+txTable(l,"rent")+'</div>'+
 '<div class="detail-box"><h3>'+historyTitle+'</h3>'+plot(historyRows)+'<p class="subtext">'+historyNote+'</p></div>'+
 '<div class="detail-box"><h3>최종 검증에 필요한 것</h3><p>① 단지 정적정보 2개 독립 출처</p><p>② 매매 계약일·층·면적·가격의 2차 출처 대조</p><p>③ 신규 전세 건별 대조</p><p>④ 이상치·취소 및 동탄 출퇴근 검토</p><p><a href="./matches.html">1차 매칭 원장 보기 →</a></p></div></div>';
 $("trial-detail").hidden=false;$("trial-detail").scrollIntoView({behavior:"smooth",block:"start"});
}
["area-filter","budget-filter","sort-filter"].forEach(id=>$(id)?.addEventListener("change",render));
document.addEventListener("radar:filters-changed",render);
document.addEventListener("click",e=>{const b=e.target.closest("[data-preview-id]");if(b)detail(b.dataset.previewId,b.dataset.previewArea);if(e.target.closest("#trial-close"))$("trial-detail").hidden=true;});
Promise.all([fetch("./data/matches/latest.json",{cache:"no-store"}),fetch("./data/complexes.json",{cache:"no-store"}),fetch("./data/history/latest.json",{cache:"no-store"})]).then(async x=>{if(!x[0].ok||!x[1].ok)throw Error("Data HTTP error");const [q,c]=await Promise.all([x[0].json(),x[1].json()]);S.queue=q;S.complexes=c.complexes||[];S.history=x[2].ok?await x[2].json():null;render();}).catch(err=>{$("preview-top").innerHTML='<div class="empty">잠정 비교 자료 로드 실패. 매칭 작업을 확인하세요.</div>';console.error(err);});
})();