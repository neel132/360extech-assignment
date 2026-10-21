import { profileColumn } from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import { timed } from "@/lib/events";

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  return timed("column", () => (name ? profileColumn(name) : { columns: getDataset().columns }));
}
