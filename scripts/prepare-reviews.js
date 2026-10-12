import { prepareReviews } from "../src/prepare-reviews.js";

try {
  if (process.argv.length !== 2) throw new Error("prepare:reviews does not accept arguments");
  const result = await prepareReviews();
  console.log(JSON.stringify({ event: "reviews_prepared", count: result.reviews.length, blocked: result.reviews.filter((review) => review.blocked.length).length }));
} catch (error) {
  console.error(JSON.stringify({ event: "reviews_preparation_failed", error: error.message }));
  process.exitCode = 1;
}
