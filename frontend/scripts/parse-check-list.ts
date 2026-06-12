// One-off smoke check: parse every claim in /claims through claimSchema.
import { claimsListSchema } from "../lib/schemas";

async function main(): Promise<void> {
  const res = await fetch("http://localhost:8000/claims");
  const data: unknown = await res.json();
  const claims = claimsListSchema.parse(data);
  console.log(`LIST PARSE OK count=${claims.length}`);
}

void main();
