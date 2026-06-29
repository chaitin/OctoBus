import test from "node:test";
import assert from "node:assert/strict";

const shouldRun = process.env.VENUS_WAF_LIVE === "1";

const maybeTest = shouldRun ? test : test.skip;

maybeTest("live WAF blacklist and whitelist smoke flow", async () => {
  const { rpcdef } = await import("../src/venus-waf.js");
  const config = {
    baseUrl: process.env.VENUS_WAF_BASE_URL,
    insecureSkipTlsVerify: process.env.VENUS_WAF_INSECURE_SKIP_TLS_VERIFY !== "0",
    timeoutMs: 10000,
  };
  const secret = {
    username: process.env.VENUS_WAF_USERNAME,
    password: process.env.VENUS_WAF_PASSWORD,
  };

  assert.ok(config.baseUrl, "VENUS_WAF_BASE_URL is required");
  assert.ok(secret.username, "VENUS_WAF_USERNAME is required");
  assert.ok(secret.password, "VENUS_WAF_PASSWORD is required");

  const base = { config, secret };
  const rule = {
    name: "octobus_agent_test_live",
    if_in: process.env.VENUS_WAF_TEST_IF_IN || "any",
    src_addrobj: process.env.VENUS_WAF_TEST_SRC_ADDROBJ || "白名单",
    dst_addrobj: process.env.VENUS_WAF_TEST_DST_ADDROBJ || "白名单",
    dst_servobj: process.env.VENUS_WAF_TEST_DST_SERVOBJ || "https_443",
    log: 1,
    log_level: 6,
    enable: 1,
    week_day: process.env.VENUS_WAF_TEST_WEEK_DAY || "7,",
    day_enable_time: process.env.VENUS_WAF_TEST_DAY_ENABLE_TIME || "0-24",
    set_periodic: 1,
  };

  const call = async (path, req = {}) => rpcdef({ ...base, req })[path]();

  assert.equal((await call("/Venus_WAF.Venus_WAF/HealthCheck")).ok, true);

  await call("/Venus_WAF.Venus_WAF/CreateBlacklist", rule);
  assert.ok((await call("/Venus_WAF.Venus_WAF/ListBlacklists")).rules.some((item) => item.name === rule.name));
  await call("/Venus_WAF.Venus_WAF/SetBlacklistEnabled", { name: rule.name, enable: 0 });
  await call("/Venus_WAF.Venus_WAF/DeleteBlacklist", { name: rule.name });
  assert.equal((await call("/Venus_WAF.Venus_WAF/ListBlacklists")).rules.some((item) => item.name === rule.name), false);

  await call("/Venus_WAF.Venus_WAF/CreateWhitelist", rule);
  assert.ok((await call("/Venus_WAF.Venus_WAF/ListWhitelists")).rules.some((item) => item.name === rule.name));
  await call("/Venus_WAF.Venus_WAF/SetWhitelistEnabled", { name: rule.name, enable: 0 });
  await call("/Venus_WAF.Venus_WAF/DeleteWhitelist", { name: rule.name });
  assert.equal((await call("/Venus_WAF.Venus_WAF/ListWhitelists")).rules.some((item) => item.name === rule.name), false);
});
