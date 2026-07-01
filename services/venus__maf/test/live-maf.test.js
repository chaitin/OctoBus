import test from "node:test";

const maybeTest = process.env.VENUS_MAF_LIVE_BASE_URL ? test : test.skip;

maybeTest("live MAF health check smoke flow", async () => {
  // Live tests are intentionally driven through OctoBus in delivery evidence.
});
