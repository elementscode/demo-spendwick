import { Request, Response } from "@elements/app";
import { requireFinance } from "#app/shared/services/auth";
import { loadExport, toCsv } from "#app/shared/services/finance";

export default function exportCsv(req: Request, res: Response) {
  requireFinance();

  let one = (v: unknown) => (Array.isArray(v) ? v[0] : v ?? "") as string;
  let quarter = one(req.query.range) !== "all";
  let rows = loadExport(one(req.query.status), one(req.query.department), quarter);
  let stamp = new Date().toISOString().slice(0, 10);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="spendwick-requests-${stamp}.csv"`);

  return Buffer.from(toCsv(rows), "utf8");
}
