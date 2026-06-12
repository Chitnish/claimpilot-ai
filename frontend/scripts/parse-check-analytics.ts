// One-off smoke check: parse /analytics and /claims/search through their schemas.
import { analyticsSchema, claimSearchResponseSchema } from "../lib/schemas";

async function main(): Promise<void> {
  const analyticsRes = await fetch("http://localhost:8000/analytics");
  const analytics = analyticsSchema.parse(await analyticsRes.json());
  console.log(
    `ANALYTICS PARSE OK claims=${analytics.totalClaims} payers=${analytics.payers.length} carcs=${analytics.topDenialReasons.length}`,
  );

  const searchRes = await fetch(
    "http://localhost:8000/claims/search?limit=5&offset=0",
  );
  const search = claimSearchResponseSchema.parse(await searchRes.json());
  console.log(
    `SEARCH PARSE OK total=${search.total} items=${search.items.length} payers=${search.payers.length}`,
  );
}

void main();
