import { getGuidePairs } from "./guide-sync-lib.mjs";

const outOfSync = getGuidePairs().filter((pair) => !pair.inSync);

if (outOfSync.length === 0) {
  console.log("Guide files are in sync.");
  process.exit(0);
}

console.error("Guide files are out of sync:");
for (const pair of outOfSync) {
  console.error(`- ${pair.target} does not match ${pair.source}`);
}
console.error("Run `npm run guides:sync` from the repository root.");
process.exit(1);
