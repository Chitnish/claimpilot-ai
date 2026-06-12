// One-off schema smoke check: parse a live backend claim through claimSchema.
import { claimSchema } from "../lib/schemas";

const claimId = process.argv[2];
if (!claimId) {
  console.error("usage: tsx scripts/parse-check.ts <claim_id>");
  process.exit(1);
}

async function main(): Promise<void> {
  const res = await fetch(`http://localhost:8000/claims/${claimId}`);
  const data: unknown = await res.json();
  const claim = claimSchema.parse(data);
  console.log(
    `PARSE OK lines=${claim.claimLines.length} era=${claim.era ? claim.era.lines.length : "null"} paid=${claim.amountPaid} findings=${claim.scrubFindings.length}`,
  );
}

void main();
