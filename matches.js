"use strict";
const el=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const won=n=>typeof n==="number"?n.toLocaleString("ko-KR",{maximumFractionDigits:3})+"억":"—";
let queue=null;
const stamp=s=>s?new Date(s).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
function table(rows,kind){
 if(!rows.length)return'<p class="notes">해당 구분의 1차 신고자료 없음</p>';
 const cells=rows.map(r=>{
   const caution=r.match_reason==="exact_lot_area_name"?"주소·타입·이름 일치":"단지명 추가 확인";
   const status=kind==="sale"?(r.cancelled?"해제":r.method==="direct"?"직거래":r.method==="brokered"?"중개":"유형 미상"):(r.lease_type==="new"?"신규":r.lease_type==="renewal"?"갱신":"구분 미상");
   const price=kind==="sale"?won(r.price_100m):won(r.deposit_100m)+(r.monthly_rent_10k_krw>0?" / 월 "+r.monthly_rent_10k_krw+"만원":"");
   return "<tr><td>"+esc(r.contract_date)+"</td><td>"+esc(r.apartment_name)+"</td><td>"+esc(r.area_m2)+"㎡</td><td>"+esc(r.floor??"—")+"</td><td class='amount'>"+price+"</td><td>"+esc(status)+"</td><td>"+esc(caution)+"</td></tr>";
 });
 return "<div class='table-scroll'><table class='tx-table'><thead><tr><th>계약일</th><th>신고단지명</th><th>면적</th><th>층</th><th>신고액</th><th>거래유형</th><th>매칭상태</th></tr></thead><tbody>"+cells.join("")+"</tbody></table></div>";
}
function unitMarkup(u,groupID){
 const c=u.counts??{},key=String(u.registered_area_m2);
 const id="unit-"+groupID.replace(/[^a-z0-9-]/gi,"")+"-"+key.replace(".","_");
 return '<div class="unit"><h3>전용 '+esc(key)+'㎡</h3><p>매매 신고 '+(c.sales??0)+'건 · 중개 '+(c.brokered_sales??0)+'건 · 직거래 '+(c.direct_sales??0)+'건</p><p>신규 전세 신고 '+(c.new_jeonse??0)+'건 · 기타 임대 '+(c.other_rent??0)+'건</p>'
    +(c.name_conflicts?'<p style="color:#b86616">단지명 추가 확인 '+esc(c.name_conflicts)+'건</p>':'')
    +'<details id="'+id+'"><summary>최근 신고 원장 보기 (최대 8건/유형)</summary><h4>매매 신고</h4>'+table(u.sales??[],"sale")+'<h4>신규 전세 신고</h4>'+table(u.new_jeonse??[],"rent")+'<h4>갱신·월세·기타</h4>'+table(u.other_rent??[],"rent")+'</details></div>';
}
function render(){
 if(!queue)return;
 const reg=el("region-filter").value;
 const q=el("name-filter").value.trim().toLocaleLowerCase();
 const status=el("status-filter").value;
 const list=(queue.candidate_groups??[]).filter(c=>{
  if(reg!=="all"&&c.region!==reg)return false;
  if(q&&!(c.registered_name+" "+(c.neighborhood??"")+" "+(c.lot_address??"")).toLocaleLowerCase().includes(q))return false;
  if(status==="needs_name_review"&&!c.match_reasons?.exact_lot_area_NAME_REVIEW)return false;
  if(status==="exact_name"&&!c.match_reasons?.exact_lot_area_name)return false;
  return true;
 });
 el("results").innerHTML=list.length?list.map(g=>
  '<article class="review"><div class="eyebrow">PROVISIONAL · NOT VERIFIED</div><h2>'+esc(g.registered_name)+'</h2>'
  +'<p class="desc">'+esc(g.region)+" · "+esc(g.neighborhood||"")+" · 지번 "+esc(g.lot_address||"미확인")+" · 총세대수(등록 참고) "+esc(g.households_from_pending_registry??"미확인")+'</p>'
  +'<p class="notes">주소·타입·단지명 일치 '+esc(g.match_reasons?.exact_lot_area_name??0)+'건 / 단지명 추가 확인 '+esc(g.match_reasons?.exact_lot_area_NAME_REVIEW??0)+'건. 전부 독립 출처 검증 전.</p>'
  +'<div class="units">'+(g.units??[]).map(u=>unitMarkup(u,g.complex_id)).join("")+'</div></article>'
 ).join(""):'<div class="empty-state"><strong>선택 조건의 잠정 매칭 후보가 없습니다.</strong><p>등록 주소가 불완전하거나 이름·세부 면적이 달라 자동 매칭을 보류한 경우일 수 있습니다.</p></div>';
}
async function start(){
 try{
  const res=await fetch("./data/matches/latest.json",{cache:"no-store"});
  if(!res.ok)throw Error("match queue not generated yet");
  queue=await res.json();
  const t=queue.totals??{};
  el("total-records").textContent=Number(t.staged_rows??0).toLocaleString("ko-KR");
  el("match-count").textContent=Number(t.provisional_matches??0).toLocaleString("ko-KR");
  el("complex-count").textContent=Number(t.provisional_complexes_with_rows??0).toLocaleString("ko-KR");
  el("name-review").textContent=Number(t.name_needs_review??0).toLocaleString("ko-KR");
  el("generated-at").textContent="매칭 실행: "+stamp(queue.generated_at_utc)+" · 근거 신고 수집: "+stamp(queue.underlying_molit_run);
  const regions=[...new Set((queue.candidate_groups??[]).map(g=>g.region).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
  el("region-filter").insertAdjacentHTML("beforeend",regions.map(r=>'<option value="'+esc(r)+'">'+esc(r)+'</option>').join(""));
  const missing=queue.missing_registry_keys??[];
  el("missing-list").innerHTML=missing.length?missing.map(x=>'<p>• '+esc(x.name)+' ('+esc(x.complex_id)+'): 지역 코드 또는 정확한 지번 재확인 필요</p>').join(""):'정확한 지번이 누락된 등록 후보는 없습니다.';
  ["region-filter","status-filter"].forEach(id=>el(id).addEventListener("change",render));
  el("name-filter").addEventListener("input",render);
  render();
 }catch(err){
  el("generated-at").textContent="단지 매칭 결과가 아직 생성되지 않았어.";
  el("results").innerHTML='<div class="empty-state"><strong>매칭 결과 대기 중</strong><p>GitHub Actions가 단지 매칭 파일을 생성하면 이 화면에 자동 표시됩니다.</p></div>';
  el("missing-list").textContent="단지 매칭 첫 실행 후 표시";
 }
}
start();