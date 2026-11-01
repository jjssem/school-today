// 날씨(기상청) + 미세먼지(에어코리아)를 대신 호출하는 Netlify Function
//   /api/weather?lat=33.47&lon=126.39&sido=제주특별자치도
// 인증키: Netlify 환경변수 DATA_GO_KR_KEY (공공데이터포털 '일반 인증키(Decoding)')
// 공공데이터포털에서 아래 두 서비스를 각각 '활용신청' 해야 같은 키로 둘 다 쓸 수 있습니다.
//   - 기상청_단기예보 ((구)_동네예보) 조회서비스
//   - 한국환경공단_에어코리아_대기오염정보
//   - 한국환경공단_에어코리아_측정소정보   (가장 가까운 측정소 찾기)

const SCHOOL_HOURS = [9, 15];   // 등교~하교 시간대 (강수 판단용)

const KMA = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/";
const AIR_BASE = "https://apis.data.go.kr/B552584/";

// 위경도 → 기상청 격자(nx, ny) 변환 (기상청 공식 LCC 변환식)
function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30, SLAT2 = 60, OLON = 126, OLAT = 38, XO = 43, YO = 136;
  const D = Math.PI / 180, re = RE / GRID;
  const s1 = SLAT1 * D, s2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(s1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = lon * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

// Netlify 서버는 UTC 시간이므로 한국 시간(KST)으로 계산
function kstParts(ms = Date.now()) {
  const d = new Date(ms + 9 * 3600e3);
  const p = n => String(n).padStart(2, "0");
  return { ymd: d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()), h: d.getUTCHours(), m: d.getUTCMinutes() };
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (text.trim().startsWith("<")) {        // 공공데이터포털은 키 오류 등을 XML로 돌려줌
    const msg = (text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/) || text.match(/<resultMsg>(.*?)<\/resultMsg>/) || [])[1];
    throw new Error(msg === "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" ? "인증키가 등록되지 않았거나 활용신청이 안 되어 있어요" : (msg || "응답 형식 오류"));
  }
  const json = JSON.parse(text);
  const code = json?.response?.header?.resultCode;
  if (code && code !== "00") {
    if (code === "03") return [];            // NO_DATA
    throw new Error(json.response.header.resultMsg);
  }
  const items = json?.response?.body?.items;
  return Array.isArray(items) ? items : (items?.item || []);
}

function kmaUrl(op, base_date, base_time, grid, rows) {
  const q = new URLSearchParams({
    serviceKey: process.env.DATA_GO_KR_KEY || "", pageNo: "1", numOfRows: String(rows),
    dataType: "JSON", base_date, base_time, nx: String(grid.nx), ny: String(grid.ny),
  });
  return KMA + op + "?" + q;
}

// 초단기실황: 지금 기온·습도·강수
async function getNow(grid) {
  let t = kstParts();
  if (t.m < 15) t = kstParts(Date.now() - 3600e3);   // 매시 정각 자료는 10분쯤 뒤에 올라옴
  const items = await getJson(kmaUrl("getUltraSrtNcst", t.ymd, String(t.h).padStart(2, "0") + "00", grid, 20));
  const v = Object.fromEntries(items.map(i => [i.category, i.obsrValue]));
  return {
    time: `${t.h}시`,
    temp: v.T1H != null ? Number(v.T1H) : null,
    humidity: v.REH != null ? Number(v.REH) : null,
    rain1h: v.RN1 != null ? Number(v.RN1) : 0,
    pty: v.PTY != null ? Number(v.PTY) : 0,
    wind: v.WSD != null ? Number(v.WSD) : null,
  };
}

// 단기예보: 오늘 최저/최고, 수업 시간 강수확률·하늘
async function getToday(grid) {
  const now = kstParts();
  // 오늘 02시 발표분에 오늘 하루치(최저·최고 포함)가 모두 들어 있음
  let baseDate = now.ymd, baseTime = "0200";
  if (now.h < 2 || (now.h === 2 && now.m < 15)) { baseDate = kstParts(Date.now() - 86400e3).ymd; baseTime = "2300"; }
  const items = await getJson(kmaUrl("getVilageFcst", baseDate, baseTime, grid, 1000));

  // 최신 발표분으로 덮어쓰기 (02,05,08,11,14,17,20,23시 발표, 10분쯤 뒤 공개)
  const bases = [2, 5, 8, 11, 14, 17, 20, 23].filter(h => h < now.h || (h === now.h && now.m >= 15));
  if (bases.length && bases.at(-1) !== 2) {
    try {
      const latest = await getJson(kmaUrl("getVilageFcst", now.ymd, String(bases.at(-1)).padStart(2, "0") + "00", grid, 1000));
      items.push(...latest);   // 뒤에 오는 값이 우선
    } catch (e) { /* 최신분 실패 시 02시 자료만 사용 */ }
  }

  const today = items.filter(i => i.fcstDate === now.ymd);
  const byHour = {};
  for (const i of today) (byHour[+i.fcstTime.slice(0, 2)] ||= {})[i.category] = i.fcstValue;
  const num = v => (v == null || v === "") ? null : Number(String(v).replace(/[^\d.-]/g, ""));
  const tmn = num(today.filter(i => i.category === "TMN").at(-1)?.fcstValue);
  const tmx = num(today.filter(i => i.category === "TMX").at(-1)?.fcstValue);
  const temps = Object.values(byHour).map(h => num(h.TMP)).filter(v => v != null);

  const school = Object.entries(byHour).filter(([h]) => +h >= SCHOOL_HOURS[0] && +h <= SCHOOL_HOURS[1]);
  const popMax = Math.max(0, ...school.map(([, v]) => num(v.POP) || 0));
  const rainHours = school.filter(([, v]) => num(v.PTY) > 0).map(([h, v]) => ({ hour: +h, pty: num(v.PTY) }));
  const mid = byHour[12] || byHour[13] || byHour[11] || {};

  return {
    tmn: tmn ?? (temps.length ? Math.min(...temps) : null),
    tmx: tmx ?? (temps.length ? Math.max(...temps) : null),
    sky: num(mid.SKY),            // 1 맑음, 3 구름많음, 4 흐림
    pty: num(mid.PTY) || 0,       // 0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기
    popMax,
    rainHours,
  };
}

// ── 에어코리아 ───────────────────────────────────────────────
const okVal = v => v != null && v !== "-" && v !== "" && !isNaN(Number(v));
const gradeOf = (v, cuts) => v == null ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4;
function airResult(item, station, distKm) {
  const pm10 = okVal(item.pm10Value) ? Number(item.pm10Value) : null;
  const pm25 = okVal(item.pm25Value) ? Number(item.pm25Value) : null;
  return {
    station, distKm: distKm != null ? Math.round(distKm * 10) / 10 : null, time: item.dataTime,
    pm10, pm25,
    grade10: gradeOf(pm10, [30, 80, 150]),   // 환경부 기준
    grade25: gradeOf(pm25, [15, 35, 75]),
  };
}
function airUrl(path, params) {
  const q = new URLSearchParams({ serviceKey: process.env.DATA_GO_KR_KEY || "", returnType: "json", pageNo: "1", ...params });
  return AIR_BASE + path + "?" + q;
}
function distKm(aLat, aLon, bLat, bLon) {
  const R = 6371, D = Math.PI / 180;
  const x = Math.sin((bLat - aLat) * D / 2) ** 2 + Math.cos(aLat * D) * Math.cos(bLat * D) * Math.sin((bLon - aLon) * D / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// 전국 측정소 목록 (하루 동안 기억)
let stationCache = null, stationAt = 0;
async function getStations() {
  if (stationCache && Date.now() - stationAt < 24 * 3600e3) return stationCache;
  const items = await getJson(airUrl("MsrstnInfoInqireSvc/getMsrstnList", { numOfRows: "1000" }));
  const list = items.map(i => {
    const a = Number(i.dmX), b = Number(i.dmY);
    // dmX/dmY 중 위도(33~39)인 값을 위도로 사용
    const [lat, lon] = (a > 30 && a < 40) ? [a, b] : [b, a];
    return { name: i.stationName, lat, lon };
  }).filter(s => s.lat && s.lon);
  if (!list.length) throw new Error("측정소 목록이 비어 있어요");
  stationCache = list; stationAt = Date.now();
  return list;
}

// 1순위: 가장 가까운 측정소 (값이 비어 있으면 다음으로 가까운 곳)
async function getAirNearest(lat, lon) {
  const near = (await getStations())
    .map(s => ({ ...s, d: distKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
  for (const s of near) {
    const items = await getJson(airUrl("ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty",
      { numOfRows: "3", stationName: s.name, dataTerm: "DAILY", ver: "1.0" }));
    const item = items.find(i => okVal(i.pm10Value) || okVal(i.pm25Value));
    if (item) return airResult(item, s.name, s.d);
  }
  throw new Error("가까운 측정소에 측정값이 없어요");
}

// 2순위(측정소정보 서비스를 못 쓸 때): 시·도 전체 측정소 중 주소가 겹치는 곳
const SIDO = [["서울","서울"],["부산","부산"],["대구","대구"],["인천","인천"],["광주","광주"],["대전","대전"],
  ["울산","울산"],["세종","세종"],["경기","경기"],["강원","강원"],["충청북","충북"],["충북","충북"],["충청남","충남"],
  ["충남","충남"],["전북","전북"],["전라북","전북"],["전라남","전남"],["전남","전남"],["경상북","경북"],["경북","경북"],
  ["경상남","경남"],["경남","경남"],["제주","제주"]];
async function getAirBySido(sidoText, addrHint) {
  const names = [...new Set(SIDO.filter(([k]) => (sidoText || "").includes(k)).map(([, v]) => v))];
  if (!names.length) throw new Error("시·도를 알 수 없어요");
  const words = (addrHint || "").split(/\s+/).map(w => w.replace(/(시|군|구|읍|면|동)$/, "")).filter(w => w.length >= 2);
  for (const sidoName of names) {
    const items = await getJson(airUrl("ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty",
      { numOfRows: "200", sidoName, ver: "1.0" }));
    const valid = items.filter(i => okVal(i.pm10Value));
    const pick = valid.find(i => words.some(w => i.stationName.includes(w))) || valid[0];
    if (pick) return airResult(pick, pick.stationName, null);
  }
  throw new Error("측정값이 없어요");
}

async function getAir(lat, lon, sido) {
  try { return await getAirNearest(lat, lon); }
  catch (e) {
    if (!sido) throw e;
    return await getAirBySido(sido, sido);
  }
}

// 운동장 활동 판단
function judge(now, today, air) {
  const reasons = [];
  let level = "ok";                         // ok / caution / no
  const worst = Math.max(air?.grade10 || 0, air?.grade25 || 0);
  if (worst >= 3) { level = "no"; reasons.push(worst === 4 ? "미세먼지 매우나쁨" : "미세먼지 나쁨"); }
  if (now?.pty > 0 || now?.rain1h > 0) { level = "no"; reasons.push("지금 비/눈"); }
  else if (today?.rainHours?.length) { if (level === "ok") level = "caution"; reasons.push(`${today.rainHours[0].hour}시쯤 비 예보`); }
  else if (today?.popMax >= 60) { if (level === "ok") level = "caution"; reasons.push(`강수확률 ${today.popMax}%`); }
  const hi = today?.tmx ?? now?.temp;
  if (hi != null && hi >= 33) { level = "no"; reasons.push(`폭염 (최고 ${hi}℃)`); }
  else if (hi != null && hi >= 31) { if (level === "ok") level = "caution"; reasons.push(`더위 (최고 ${hi}℃)`); }
  if (now?.temp != null && now.temp <= -5) { if (level === "ok") level = "caution"; reasons.push(`추위 (${now.temp}℃)`); }
  if (now?.wind != null && now.wind >= 9) { if (level === "ok") level = "caution"; reasons.push(`강풍 (${now.wind}m/s)`); }
  const umbrella = (now?.pty > 0) || (today?.rainHours?.length > 0) || (today?.popMax >= 60);
  return { level, reasons, umbrella };
}

export default async (req) => {
  if (!process.env.DATA_GO_KR_KEY) {
    return Response.json({ error: "Netlify 환경변수 DATA_GO_KR_KEY 가 설정되지 않았어요." }, { status: 500 });
  }
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lon = Number(p.get("lon"));
  const sido = p.get("sido") || "";
  if (!(lat > 32 && lat < 39.5 && lon > 124 && lon < 132)) {
    return Response.json({ error: "lat, lon 값이 필요해요 (국내 좌표)." }, { status: 400 });
  }
  const grid = toGrid(lat, lon);
  const [n, t, a] = await Promise.allSettled([getNow(grid), getToday(grid), getAir(lat, lon, sido)]);
  const now = n.status === "fulfilled" ? n.value : null;
  const today = t.status === "fulfilled" ? t.value : null;
  const air = a.status === "fulfilled" ? a.value : null;
  const errors = {};
  if (!now) errors.now = n.reason?.message;
  if (!today) errors.today = t.reason?.message;
  if (!air) errors.air = a.reason?.message;
  if (!now && !today && !air) {
    return Response.json({ error: Object.values(errors)[0] || "날씨 정보를 불러오지 못했어요", errors, grid }, { status: 502 });
  }
  return Response.json(
    { now, today, air, outdoor: judge(now, today, air), errors, grid },
    { headers: { "Cache-Control": "public, max-age=900" } }   // 15분 캐시
  );
};

export const config = { path: "/api/weather" };
