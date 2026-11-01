# 우리 학교 오늘

내 위치(GPS·와이파이) 또는 접속 IP로 가까운 학교를 찾아, 그 학교의 오늘·내일 급식과 날씨·미세먼지를 보여 주는 사이트입니다.

## 폴더 구성
- `public/index.html` — 화면
- `netlify/functions/schools.mjs` — 학교 찾기 (위치·IP·이름 검색)
- `netlify/functions/meal.mjs` — 급식 (나이스)
- `netlify/functions/weather.mjs` — 날씨 (기상청) + 미세먼지 (에어코리아)
- `data/schools.csv` — 전국초중등학교위치표준데이터 (공공데이터포털 원본 CSV)
- `tools/build-schools.mjs` — 배포할 때 CSV를 `generated/schools.json`으로 자동 변환

## Netlify 환경변수
- `NEIS_API_KEY` — 나이스 교육정보 개방 포털 인증키
- `DATA_GO_KR_KEY` — 공공데이터포털 일반 인증키(Decoding). 아래 3개 서비스 활용신청 필요
  - 기상청_단기예보 ((구)_동네예보) 조회서비스
  - 한국환경공단_에어코리아_대기오염정보
  - 한국환경공단_에어코리아_측정소정보

## 학교 자료 새로 고치기
1. 공공데이터포털에서 「전국초중등학교위치표준데이터」 CSV를 새로 내려받습니다.
2. GitHub의 `data/schools.csv`를 새 파일로 바꿔 올립니다 (파일 이름은 `schools.csv` 그대로).
3. Netlify가 자동으로 다시 배포하면서 변환합니다. 화면 맨 아래 '데이터기준일'이 바뀌면 완료.

## 학교별 바로가기 주소
학교를 고르면 주소가 `…/?s=학교ID` 로 바뀝니다. 이 주소를 즐겨찾기하거나 QR로 만들면 그 학교가 바로 열립니다.
