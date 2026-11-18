"use strict";
const e=id=>document.getElementById(id);
const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const formatPrice=n=>typeof n==="number"?n.toLocaleString("ko-KR",{maximumFractionDigits:3})+"억":"—";
const stamp=s=>s?new Date(s).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
let staging=null;
function draw(){
 const rr=e("r-filter").value,tt=e("t-filter").value,mm=e("m-filter").value;
 const rows=(staging.records||[]).filter(r=>(rr==="all"||r.region_code===rr)&&(tt==="all"||r.record_kind===tt)&&(mm==="all"||r.requested_month===mm)).slice(0,100);
 const head="<table class='primary-table'><thead><tr><th>계약일</th><th>지역·법정동</th><th>신고 단지명</th><th>전용</th><th>층</th><th>유형</th><th class='number'>신고 금액</th><th>원문 상태</th></tr></thead><tbody>";
 const tr=rows.map(r=>{const amt=r.record_kind==="sale"?formatPrice(r.price_100m):formatPrice(r.deposit_100m)+(r.monthly_rent_10k_krw>0?(" / 월 "+r.monthly_rent_10k_krw+"만원"):"");
 const state=r.record_kind==="sale"?(r.cancelled?"해제 신고":r.method==="direct"?"직거래":r.method==="brokered"?"중개거래":"유형 미상"):(r.lease_type==="new"?"신규":r.lease_type==="renewal"?"갱신":"계약구분 미상");
 return "<tr><td>"+escapeHtml(r.contract_date)+"</td><td>"+escapeHtml(r.region_name+" "+r.legal_dong)+"</td><td>"+escapeHtml(r.apartment_name)+"</td><td>"+escapeHtml(r.area_m2)+"㎡</td><td>"+escapeHtml(r.floor??"—")+"</td><td>"+(r.record_kind==="sale"?"매매":"전월세")+"</td><td class='number'>"+amt+"</td><td>"+escapeHtml(state)+"</td></tr>"}).join("");
 e("records-table").innerHTML=rows.length?head+tr+"</tbody></table>":"<p>선택 조건에 맞는 신고자료 없음</p>";
}
async function init(){
 try{
  const response=await fetch("./data/molit/latest.json",{cache:"no-store"});
  if(!response.ok)throw new Error("staging file not available");
  staging=await response.json();
  e("at").textContent=stamp(staging.generated_at_utc);
  e("sales").textContent=(staging.counts?.sale_in_scope??0).toLocaleString("ko-KR")+"건";
  e("rents").textContent=(staging.counts?.rent_in_scope??0).toLocaleString("ko-KR")+"건";
  const regions=staging.regions||[];
  e("region-table").innerHTML="<table class='primary-table'><thead><tr><th>지역</th><th class='number'>매매</th><th class='number'>전월세</th></tr></thead><tbody>"+regions.map(r=>"<tr><td>"+escapeHtml(r.region_name)+"</td><td class='number'>"+Number(r.sale||0).toLocaleString()+"</td><td class='number'>"+Number(r.rent||0).toLocaleString()+"</td></tr>").join("")+"</tbody></table>";
  e("r-filter").insertAdjacentHTML("beforeend",regions.map(r=>'<option value="'+escapeHtml(r.region_code)+'">'+escapeHtml(r.region_name)+'</option>').join(""));
  e("m-filter").insertAdjacentHTML("beforeend",(staging.periods||[]).map(x=>'<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>').join(""));
  ["r-filter","t-filter","m-filter"].forEach(id=>e(id).addEventListener("change",draw));draw();
 }catch(_){
  e("at").textContent="미실행";e("sales").textContent="수집 전";e("rents").textContent="수집 전";
  e("region-table").innerHTML="<p class='status-danger'>아직 API 인증키를 연결해 수집 작업을 성공적으로 실행하지 않았습니다.</p>";
  e("records-table").innerHTML="<p>국토부 데이터가 처음 수집되면 이곳에 표시됩니다.</p>";
 }
}
init();
