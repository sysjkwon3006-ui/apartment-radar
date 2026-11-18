# 단지·거래 2차 검증 운영 규칙 (v0.3)

## 현재 자동화 단계
1. 국토부 매매/전월세 신고를 data/molit/latest.json에 1차 수집.
2. scripts/match_candidates.py가 시군구코드 + 법정동 + 정확한 지번 + 전용면적(차이 0.01㎡ 미만)을 동시에 대조.
3. 단지 이름까지 문장부호·공백만 제거해 동일하면 exact_lot_area_name, 다르면 exact_lot_area_NAME_REVIEW로 표시.
4. 매칭 결과를 data/matches/latest.json에 저장. 실제 대시보드 matches.html에서 이름·거래·타입 검토.
5. 이 파일로는 단지의 검증 상태를 절대 변경하지 않음. TOP5는 별도 승인자료만 사용.

## 검증 작업 체크리스트 (단지별·전용면적별)
- [ ] 법정동코드 / 지번 / 도로명주소 / 단지명 (인접 단지 혼동 확인)
- [ ] 총세대수 500 이상 (단지 전체인지 특정 동/타입인지 확인)
- [ ] 사용승인연도와 실제 전용면적 타입의 독립된 자료 2개 이상
- [ ] 단지명 API 원문 및 공인 별칭 검토: 별칭은 신뢰자료 확인 후 verified_aliases에 수동으로 추가
- [ ] 동일 세부 전용면적 매매 3~5건 계약일·층·가격을 두 서비스에서 1:1 대조
- [ ] 직거래, 해제/정정, 계약유형 미상을 적절히 제외하거나 분리
- [ ] 동일 세부 전용면적 신규 전세 3~5건, 월세·갱신 제외
- [ ] 수급·가격 판단 기준일과 거래 신고 지연 명시
- [ ] 단지 실거주·재건축/정비사업 추진 단계, 동탄 출퇴근 평가의 자료 출처
- [ ] 월별 정상거래 중앙값/실제 점으로만 24개월 가격차트 구성, 없는 달은 공백

## 출처독립성
- 1차 출처: 국토부 실거래 API.
- 2차 출처: 법적 이용 조건에 맞는 다른 부동산 서비스의 건별 거래 화면/조회 데이터.
- 서로 다른 국토부 API 엔드포인트를 두 개 호출했다고 독립 2개 출처로 간주하지 않음.
- 두 출처의 날짜·동/층·면적·가격이 다르면 확정 거래가 아닌 검증 필요.
- 공개자료만으로 특수관계 거래를 확정할 수 없으므로 이상거래 표시는 추정으로 제한.

## 단지 ID와 타입
data/complexes.json의 id는 고유 단지키이고, 면적은 types[].area_m2 소수점 자리까지 고정해 관리합니다. 전용 84.95㎡와 84.9763㎡, 또는 같은 마을의 다른 단지를 자동으로 합치지 않습니다. 특정 타입의 정확한 면적이 불확실하면 types[].status=pending을 유지하고 거래를 검증 완료로 승격시키지 마세요.

초기 매칭되지 않은 단지는 data/matches/latest.json의 missing_registry_keys를 확인해서 공공 공동주택 단지정보 및 다른 독립 출처로 주소를 재확인한 다음 지번을 보완합니다. 매칭률을 높이기 위해 주소를 추측하거나 면적 허용 오차를 늘리는 방식은 금지합니다.

## 사람이 승인한 검증 기록
승인할 때에는 단지 정보 출처별 원문 URL, 조회일, 정확히 어떤 필드를 확인했는지, 거래별 1차/2차 증빙 URL(또는 승인 가능한 원장 식별자)을 남깁니다. data/complexes.json의 verification.status="verified"와 거래별 verified=true는 독립 출처 확인 후 수동 리뷰를 거쳐 입력하고, GitHub PR과 검사 로그로 추적하는 방식을 권장합니다.

현 단계에서 자동 웹스크래핑으로 KB/호갱노노 등의 서비스 데이터를 가져오거나, 독립 확인 없이 기계적으로 verified=true로 바꾸는 코드는 없습니다.

## 링크
- 검증 대기열: https://apartment-radar.pages.dev/matches.html
- 원본 수집: https://apartment-radar.pages.dev/primary.html
- 최종 추천: https://apartment-radar.pages.dev/
- 주간 수집: https://github.com/sysjkwon3006-ui/apartment-radar/actions/workflows/weekly.yml
- 매칭 재생성: https://github.com/sysjkwon3006-ui/apartment-radar/actions/workflows/match_on_change.yml
