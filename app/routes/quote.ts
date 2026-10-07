import { Request, Response, sql } from "@elements/app";
import { currentUser } from "#app/shared/services/auth";
import { viewable } from "#app/shared/services/requests";

// Types we are willing to render on our own origin. Anything else downloads.
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"]);

export default function serveQuote(req: Request, res: Response) {
  viewable(currentUser(), req.params.id);

  let quote = sql<{ quoteName: string; quoteContentType: string; quoteData: Buffer }>(`
    select
      quoteName,
      quoteContentType,
      quoteData
    from requests
    where
      id = ${req.params.id}
      and quoteData is not null
  `).firstOrThrow();

  let name = quote.quoteName.replace(/[^\w.\- ]+/g, "_");

  if (INLINE.has(quote.quoteContentType)) {
    res.setHeader("Content-Type", quote.quoteContentType === "text/plain" ? "text/plain; charset=utf-8" : quote.quoteContentType);
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
  } else {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  }

  return quote.quoteData;
}
