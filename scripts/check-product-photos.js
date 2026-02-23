const products = require("../server/data/products");

const total = products.length;
const withRealPhoto = products.filter((p) => p.hasRealPhoto);
const missing = products.filter((p) => !p.hasRealPhoto);
const coverage = total ? ((withRealPhoto.length / total) * 100).toFixed(1) : "0.0";

console.log(`Product photo coverage: ${withRealPhoto.length}/${total} (${coverage}%)`);

if (!missing.length) {
  console.log("All products have real photos.");
  process.exit(0);
}

console.log("\nMissing real photos:");
for (const p of missing) {
  console.log(`- ${p.slug} (${p.name})`);
}

console.log(
  "\nAdd files to public/assets/products/real/ using product slug names, e.g. " +
  "smoky-beef-burger.jpg"
);
