import dynamic from "next/dynamic";
export const StargazerMapDynamic = dynamic(
  () => import("./stargazer-map").then((m) => ({ default: m.StargazerMap })),
  { ssr: false, loading: () => <div className="w-full h-full bg-[#0d1117]" /> }
);
