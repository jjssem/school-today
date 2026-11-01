// 기상특보 확인용: /api/warnings?addr=학교주소
// 원본(t6 발효현황, t7 예비특보)과 해석 결과, 학교에 해당하는 특보를 함께 돌려줍니다.
import { warningsFor, RELEVANT } from "../lib/warnings-core.mjs";

export default async (req) => {
  if (!process.env.DATA_GO_KR_KEY) {
    return Response.json({ error: "Netlify 환경변수 DATA_GO_KR_KEY 가 설정되지 않았어요." }, { status: 500 });
  }
  const addr = new URL(req.url).searchParams.get("addr") || "";
  try {
    const w = await warningsFor(addr);
    return Response.json({ addr, relevantKinds: RELEVANT, ...w }, {
      headers: { "Cache-Control": "public, max-age=300", "Netlify-CDN-Cache-Control": "public, durable, max-age=600" },
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
};

export const config = { path: "/api/warnings" };
