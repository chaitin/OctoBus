let sdk = {};
try {
  sdk = require('@chaitin-ai/octobus-sdk');
} catch {}
const { handlers } = require('./hillstone-waf-v5-5-r12.js');
const defineService = sdk.defineService || ((value) => value);

module.exports = {
  handlers,
  service: defineService({ handlers }),
};
