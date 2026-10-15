import { asset } from "../content";

/** Logo plus wordmark, as in the app's toolbar. */
export function Brand() {
  return (
    <>
      <img src={asset("logo.png")} alt="" width={28} height={28} className="rounded-sm" />
      Parquet Viewer
    </>
  );
}

export const brandClass = "flex items-center gap-2.5 text-[15px] font-bold tracking-[-0.3px] text-on-dark";
