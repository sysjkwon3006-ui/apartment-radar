"use strict";
const $=id=>document.getElementById(id);
const state={complexes:[],meta:null,filtered:[]};
const budgets={"10-15-84":{low:10,high:15,minArea:80,maxArea:90},"15-20-84":{low:15,high:20,minArea:80,maxArea:90},"20-30-84":{low:20,high:30,minArea:80,maxArea:90},"20-30-large":{low:20,high:30,minArea:100,maxArea:135}};
const fmt=n=>Number.isFinite(n)?n.toLocaleString("ko-KR",{maximumFractionDigits:2})+"억":"검증 필요";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const routeToArea=(item,area)=>area==="all"||item.region===area||item.district===area||item.neighborhood===area||Array.isArray(item.tags)&&item.tags.includes(area);
const hasEvidence=a=>Array.isArray(a)&&new Set(a.map(x=>x.organization).filter(Boolean)).size>=2;
const validated=c=>c.verification?.status==="verified"&&c.households>=500&&hasEvidence(c.static_sources)&&hasEvidence(c.sales_sources)&&hasEvidence(c.lease_sources)&&Array.isArray(c.sales)&&c.sales.filter(x=>x.verified===true&&x.type==="brokered"&&!x.cancelled).length>=3&&Array.isArray(c.leases)&&c.leases.filter(x=>x.verified===true&&x.type==="new"&&!x.cancelled).length>=3&&Boolean(c.verification.checked_at);
const saleValues=c=>(c.sales||[]).filter(x=>x.verified===true&&x.type==="brokered"&&!x.cancelled).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(x=>x.price_100m);
const median=a=>{if(!a.length)return null;const s=[...a].sort((a,b)=>a-b);return s.length%2?s[Math.floor(s.length/2)]:(s[s.length/2-1]+s[s.length/2])/2};
const activeType=(c,b)=>c.types?.some(t=>t.area_m2>=b.minArea&&t.area_m2<=b.maxArea&&t.status==="verified");
const budgetMatch=(c,b)=>{const s=saleValues(c);return activeType(c,b)&&s.length>=3&&median(s)>=b.low&&median(s)<=b.high&&Math.max(...s)<=b.high};
const rankScore=(c,priority)=>({asset:c.score?.asset??0,value:c.score?.value??0,commute:c.score?.commute??0,living:c.score?.living??0}[priority]??0);
function dateFmt(s){return s?esc(s):"검증 필요"}
function card(c,pending){
 const labels=[c.district,c.neighborhood,c.households?c.households.toLocaleString()+"세대":null].filter(Boolean);
 const note=pending?"단지·타입·거래 교차검증 완료 전에는 추천 순위에서 제외됩니다.":"동일면적 최근 검증 중개거래를 기준으로 가격을 판단합니다.";
 return '<article class="complex-card"><div class="card-head"><span class="pill '+(pending?"warning":"")+'">'+(pending?"검증 대기":"검증 완료")+'</span><small>'+(pending?"순위 없음":"추천 가능")+'</small></div><h3>'+esc(c.name)+'</h3><p>'+esc(c.address||"주소 검증 대기")+'</p><div class="meta">'+labels.map(x=>"<span>"+esc(x)+"</span>").join("")+'</div><p>'+note+'</p><div class="card-foot"><small>기준일 '+dateFmt(c.verification?.checked_at)+'</small><button type="button" class="text-btn" data-detail="'+esc(c.id)+'">상세 보기 →</button></div></article>';
}
function drawChart(c){
 const cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-24);
 const data=(c.trend||[]).filter(x=>x.verified===true&&x.month&&Number.isFinite(x.median_price_100m)).sort((a,b)=>a.month.localeCompare(b.month));
 if(!data.length)return '<div class="empty-chart">검증된 24개월 실거래 원자료가 없습니다.<br>값을 추정하거나 빈 달을 보간하지 않습니다.</div>';
 const min=Math.floor(Math.min(...data.map(x=>x.median_price_100m))-1),max=Math.ceil(Math.max(...data.map(x=>x.median_price_100m))+1),range=Math.max(max-min,1);
 const w=620,h=190,pad=34;let marks=data.map(x=>{const [yy,mm]=x.month.split("-").map(Number);const idx=yy*12+mm;const end=new Date();const eIdx=end.getFullYear()*12+end.getMonth()+1;const offset=eIdx-idx;if(offset<0||offset>23)return "";const cx=pad+(23-offset)/23*(w-2*pad),cy=h-pad-((x.median_price_100m-min)/range)*(h-2*pad);return '<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="5" fill="#2363b7"><title>'+esc(x.month)+": "+esc(x.median_price_100m)+"억원 · "+esc(x.count)+"건</title></circle>";}).join("");
 return '<svg viewBox="0 0 620 190" role="img" aria-label="최근 24개월 중 검증 거래가 있는 달의 매매 중앙값 산점도, 보간 없음"><line x1="34" y1="156" x2="586" y2="156" stroke="#cbd5e1"/><text x="4" y="30" font-size="11" fill="#64748b">'+max+'억</text><text x="4" y="156" font-size="11" fill="#64748b">'+min+'억</text>'+marks+'</svg>';
}
function transactions(t){if(!t.length)return'<p>건별 교차검증 완료 내역 없음</p>';return'<table class="tx-table"><thead><tr><th>계약일</th><th>층</th><th>면적</th><th>가격</th></tr></thead><tbody>'+t.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.floor)+'</td><td>'+esc(x.area_m2)+'㎡</td><td>'+fmt(x.price_100m)+'</td></tr>').join("")+'</tbody></table>';}
function detail(id){
 const c=state.complexes.find(x=>x.id===id);if(!c)return;
 $('detail-title').textContent=c.name;
 const ok=validated(c),sales=(c.sales||[]).filter(x=>x.verified===true&&x.type==="brokered"&&!x.cancelled).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5),leases=(c.leases||[]).filter(x=>x.verified===true&&x.type==="new"&&!x.cancelled).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
 const sv=sales.map(x=>x.price_100m),lv=leases.map(x=>x.price_100m);
 const ratio=sv.length&&lv.length?median(lv)/median(sv)*100:null;
 const range=v=>v.length?fmt(Math.min(...v))+" ~ "+fmt(Math.max(...v)):"검증 필요";
 const prices=c.pricing||{};
 const sources=[...(c.static_sources||[]),...(c.sales_sources||[]),...(c.lease_sources||[])].filter(x=>x.url&&/^https:\/\//.test(x.url));
 $('detail-content').innerHTML='<p class="subtext">'+(ok?"검증 완료":"검증 대기 — 아래 비어 있는 항목은 추정하지 않습니다.")+'</p><div class="detail-grid"><div class="detail-box"><h3>단지 정보</h3><dl><dt>주소</dt><dd>'+esc(c.address||"검증 필요")+'</dd><dt>지번</dt><dd>'+esc(c.lot_address||"검증 필요")+'</dd><dt>총세대수</dt><dd>'+esc(c.households??"검증 필요")+'</dd><dt>준공</dt><dd>'+esc(c.built_year??"검증 필요")+'</dd><dt>면적</dt><dd>'+esc((c.types||[]).map(t=>t.area_m2+"㎡").join(", ")||"검증 필요")+'</dd><dt>마지막 검증</dt><dd>'+dateFmt(c.verification?.checked_at)+'</dd></dl></div><div class="detail-box"><h3>가격·판단</h3><dl><dt>최근 정상 매매</dt><dd>'+range(sv)+'</dd><dt>최근 신규 전세</dt><dd>'+range(lv)+'</dd><dt>전세가율(중앙값)</dt><dd>'+(ratio!==null?ratio.toFixed(1)+"%":"검증 필요")+'</dd><dt>관심가격</dt><dd>'+fmt(ok?prices.interest:null)+'</dd><dt>적정가격</dt><dd>'+((ok&&Number.isFinite(prices.fair_min)&&Number.isFinite(prices.fair_max))?fmt(prices.fair_min)+"~"+fmt(prices.fair_max):"검증 필요")+'</dd><dt>추격주의</dt><dd>'+fmt(ok?prices.chase:null)+'</dd></dl></div><div class="detail-box"><h3>최근 5건 정상 중개 매매</h3>'+transactions(sales)+'</div><div class="detail-box"><h3>최근 5건 신규 전세</h3>'+transactions(leases)+'</div><div class="detail-box"><h3>24개월 매매가격 추세</h3><div class="chart-wrap">'+drawChart(c)+'</div></div><div class="detail-box"><h3>입지·위험·근거</h3><p>동탄 출퇴근: '+esc(c.commute_note||"실측 필요")+'</p><p>장점: '+esc(c.pros||"추가 검증 필요")+'</p><p>단점: '+esc(c.cons||"추가 검증 필요")+'</p><p>자료 출처: '+(sources.length?sources.map(x=>'<a target="_blank" rel="noopener noreferrer" href="'+esc(x.url)+'">'+esc(x.organization)+'</a>').join(" · "):"건별 교차검증 완료 링크 없음")+'</p></div></div>';
 $('detail').hidden=false;$('detail').scrollIntoView({behavior:"smooth",block:"start"});
}
function render(){
 const area=$('area-filter').value,budget=$('budget-filter').value,priority=$('sort-filter').value,b=budgets[budget];
 const candidates=state.complexes.filter(c=>routeToArea(c,area)),verified=candidates.filter(c=>validated(c)&&budgetMatch(c,b)).sort((a,b)=>rankScore(b,priority)-rankScore(a,priority)).slice(0,5);
 const pending=candidates.filter(c=>!validated(c)&&(c.types||[]).some(t=>t.area_m2>=b.minArea&&t.area_m2<=b.maxArea)).sort((a,b)=>(a.name||"").localeCompare(b.name||"","ko"));
 $('total-count').textContent=state.complexes.length;$('verified-count').textContent=state.complexes.filter(validated).length;$('top-count').textContent=verified.length;
 $('top-title').textContent=(area==="all"?"전체":area)+" · "+(budget==="20-30-large"?"20~30억 / 100~135㎡":budget==="20-30-84"?"20~30억 / 84㎡":budget==="15-20-84"?"15~20억 / 84㎡":"10~15억 / 84㎡");
 $('top-results').innerHTML=verified.length?'<div class="cards">'+verified.map(c=>card(c,false)).join("")+'</div>':'<div class="empty"><strong>현재 조건에 맞는 검증 완료 TOP5가 없습니다.</strong><p>아래 검증 대기 후보를 확인할 수 있어요. 거래가 미확인인 상태에서 임의로 순위를 채우지 않습니다.</p></div>';
 $('pending-count').textContent=pending.length+"개";
 $('pending-results').innerHTML=pending.length?pending.map(c=>card(c,true)).join(""):'<div class="empty"><strong>등록된 대기 후보가 없습니다.</strong><p>지역 후보를 확장하려면 공개자료로 정적정보부터 확인해야 합니다.</p></div>';
 $('detail').hidden=true;
}
async function start(){
 const r=await Promise.all([fetch("./data/complexes.json",{cache:"no-store"}),fetch("./data/site-meta.json",{cache:"no-store"})]);
 if(r.some(x=>!x.ok))throw new Error("HTTP "+r.map(x=>x.status).join(","));
 const [data,meta]=await Promise.all(r.map(x=>x.json()));
 if(!Array.isArray(data.complexes))throw new Error("단지 데이터 오류");
 state.complexes=data.complexes;state.meta=meta;
 $('status-text').textContent=(meta.message||"갱신상태 확인 필요")+" · 최근 점검 "+(meta.last_pipeline_run||"미실행");
 $('last-verified').textContent=meta.last_verified_at||"아직 없음";
 $('area-filter').value="금곡동";render();
}
["area-filter","budget-filter","sort-filter"].forEach(id=>$(id).addEventListener("change",render));
$('reset-btn').addEventListener("click",()=>{$('area-filter').value="all";$('budget-filter').value="20-30-large";$('sort-filter').value="asset";render()});
$('close-detail').addEventListener("click",()=>$('detail').hidden=true);
document.addEventListener("click",e=>{const btn=e.target.closest("[data-detail]");if(btn)detail(btn.dataset.detail)});
start().catch(e=>{$('status-text').textContent="데이터 로드 실패 — GitHub 배포 파일 확인 필요";$('top-results').innerHTML='<div class="empty">데이터를 불러오지 못했습니다.</div>';console.error(e)});
