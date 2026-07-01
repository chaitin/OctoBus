#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { Command } from "commander";

const services = {
  "alibaba-cloud-simple-application-server-firewall": {
    entryFile: "../alibaba-cloud__simple-application-server-firewall/bin/alibaba-cloud-simple-application-server-firewall.js",
    serviceModule: "../alibaba-cloud__simple-application-server-firewall/src/service.js",
  },
  "safeline-waf": {
    entryFile: "../chaitin__safeline-waf/bin/safeline-waf.js",
    serviceModule: "../chaitin__safeline-waf/src/service.js",
  },
  "safeline-waf-eliminate-false-positive": {
    entryFile: "../chaitin__safeline-waf-eliminate-false-positive/bin/safeline-waf-eliminate-false-positive.js",
    serviceModule: "../chaitin__safeline-waf-eliminate-false-positive/src/service.js",
  },
  "cloudatlas": {
    entryFile: "../chaitin__cloudatlas/bin/cloudatlas.js",
    serviceModule: "../chaitin__cloudatlas/src/service.js",
  },
  "das-gateway-v3": {
    entryFile: "../das__gateway_v3/bin/das-gateway-v3.js",
    serviceModule: "../das__gateway_v3/src/service.js",
  },
  "das-tgfw-v6": {
    entryFile: "../das__tgfw_v6/bin/das-tgfw-v6.js",
    serviceModule: "../das__tgfw_v6/src/service.js",
  },
  "dbaudit": {
    entryFile: "../das__dbaudit/bin/dbaudit.js",
    serviceModule: "../das__dbaudit/src/service.js",
  },
  "defectdojo": {
    entryFile: "../defectdojo__defectdojo/bin/defectdojo.js",
    serviceModule: "../defectdojo__defectdojo/src/service.js",
  },
  "dingtalk-group-robot": {
    entryFile: "../dingtalk__group-robot/bin/dingtalk-group-robot.js",
    serviceModule: "../dingtalk__group-robot/src/service.js",
  },
  "dptech-eds": {
    entryFile: "../dptech__eds/bin/dptech-eds.js",
    serviceModule: "../dptech__eds/src/service.js",
  },
  "dptech-fw-v4-6-10": {
    entryFile: "../dptech__fw_v4-6-10/bin/dptech-fw-v4-6-10.js",
    serviceModule: "../dptech__fw_v4-6-10/src/service.js",
  },
  "dptech-umc-ads-v5-3-29": {
    entryFile: "../dptech__umc-ads_v5-3-29/bin/dptech-umc-ads-v5-3-29.js",
    serviceModule: "../dptech__umc-ads_v5-3-29/src/service.js",
  },
  "elastic-kibana-7-17-26": {
    entryFile: "../elastic__kibana_7-17-26/bin/elastic-kibana-7-17-26.js",
    serviceModule: "../elastic__kibana_7-17-26/src/service.js",
  },
  "feishu-group-robot": {
    entryFile: "../feishu__group-robot/bin/feishu-group-robot.js",
    serviceModule: "../feishu__group-robot/src/service.js",
  },
  "first-epss-v1": {
    entryFile: "../first__epss-v1/bin/first-epss-v1.js",
    serviceModule: "../first__epss-v1/src/service.js",
  },
  "fortinet-fw": {
    entryFile: "../fortinet__fw/bin/fortinet-fw.js",
    serviceModule: "../fortinet__fw/src/service.js",
  },
  "fortinet-waf": {
    entryFile: "../fortinet__waf/bin/fortinet-waf.js",
    serviceModule: "../fortinet__waf/src/service.js",
  },
  "hermes-gateway": {
    entryFile: "../hermes__gateway/bin/hermes-gateway.js",
    serviceModule: "../hermes__gateway/src/service.js",
  },
  "hillstone-fw-v5-5-r10": {
    entryFile: "../hillstone__fw_v5-5-r10/bin/hillstone-fw-v5-5-r10.js",
    serviceModule: "../hillstone__fw_v5-5-r10/src/service.js",
  },
  "hillstone-fw-v5-5-r4": {
    entryFile: "../hillstone__fw_v5-5-r4/bin/hillstone-fw-v5-5-r4.js",
    serviceModule: "../hillstone__fw_v5-5-r4/src/service.js",
  },
  "hillstone-fw-v5-5-r6": {
    entryFile: "../hillstone__fw_v5-5-r6/bin/hillstone-fw-v5-5-r6.js",
    serviceModule: "../hillstone__fw_v5-5-r6/src/service.js",
  },
  "huorong-endpoint-security-management-system-v2-0-19-3": {
    entryFile: "../huorong__endpoint-security-management-system_v2-0-19-3/bin/huorong-endpoint-security-management-system-v2-0-19-3.js",
    serviceModule: "../huorong__endpoint-security-management-system_v2-0-19-3/src/service.js",
  },
  "huawei-fw-usg6000e": {
    entryFile: "../huawei__fw-usg6000e/bin/huawei-fw-usg6000e.js",
    serviceModule: "../huawei__fw-usg6000e/src/service.js",
  },
  "imperva-waf-gateway-v13-6-90": {
    entryFile: "../imperva__waf-gateway_v13-6-90/bin/imperva-waf-gateway-v13-6-90.js",
    serviceModule: "../imperva__waf-gateway_v13-6-90/src/service.js",
  },
  "nsfocus-ads-v4-5-r90-f06": {
    entryFile: "../nsfocus__ads_v4-5-r90-f06/bin/nsfocus-ads-v4-5-r90-f06.js",
    serviceModule: "../nsfocus__ads_v4-5-r90-f06/src/service.js",
  },
  "nsfocus-nips-v5-6-r11": {
    entryFile: "../nsfocus__nips_v5-6-r11/bin/nsfocus-nips-v5-6-r11.js",
    serviceModule: "../nsfocus__nips_v5-6-r11/src/service.js",
  },
  "owasp-dependency-track-sca-v5-0": {
    entryFile: "../owasp__dependency-track-sca_v5-0/bin/owasp-dependency-track-sca-v5-0.js",
    serviceModule: "../owasp__dependency-track-sca_v5-0/src/service.js",
  },
  "panabit-tang-r1": {
    entryFile: "../panabit__tang-r1/bin/panabit-tang-r1.js",
    serviceModule: "../panabit__tang-r1/src/service.js",
  },
  "qianxin-fw-secgate3600": {
    entryFile: "../qianxin__fw-secgate3600/bin/qianxin-fw-secgate3600.js",
    serviceModule: "../qianxin__fw-secgate3600/src/service.js",
  },
  "qianxin-fw-secgate3600-http-x": {
    entryFile: "../qianxin__fw-secgate3600-http-x/bin/qianxin-fw-secgate3600-http-x.js",
    serviceModule: "../qianxin__fw-secgate3600-http-x/src/service.js",
  },
  "qianxin-hunter": {
    entryFile: "../qianxin__hunter_v23-1/bin/qianxin-hunter.js",
    serviceModule: "../qianxin__hunter_v23-1/src/service.js",
  },
  "qiming-tianqing-waf": {
    entryFile: "../qiming-tianqing__waf/bin/qiming-tianqing-waf.js",
    serviceModule: "../qiming-tianqing__waf/src/service.js",
  },
  "qingteng-hids-v3-4": {
    entryFile: "../qingteng__hids_v3-4/bin/qingteng-hids-v3-4.js",
    serviceModule: "../qingteng__hids_v3-4/src/service.js",
  },
  "qingteng-hids-v5": {
    entryFile: "../qingteng__hids_v5/bin/qingteng-hids-v5.js",
    serviceModule: "../qingteng__hids_v5/src/service.js",
  },
  "ray-waf-v6-1-2": {
    entryFile: "../ray__waf_v6-1-2/bin/ray-waf-v6-1-2.js",
    serviceModule: "../ray__waf_v6-1-2/src/service.js",
  },
  "riversafe-waf": {
    entryFile: "../riversafe__waf/bin/riversafe-waf.js",
    serviceModule: "../riversafe__waf/src/service.js",
  },
  "sangfor-fw-v8-0-45": {
    entryFile: "../sangfor__fw_v8-0-45/bin/sangfor-fw-v8-0-45.js",
    serviceModule: "../sangfor__fw_v8-0-45/src/service.js",
  },
  "sangfor-xdr-v2-0-45": {
    entryFile: "../sangfor__xdr_v2-0-45/bin/sangfor-xdr-v2-0-45.js",
    serviceModule: "../sangfor__xdr_v2-0-45/src/service.js",
  },
  "slack-group-robot": {
    entryFile: "../slack__group-robot/bin/slack-group-robot.js",
    serviceModule: "../slack__group-robot/src/service.js",
  },
  "skycloud-inet": {
    entryFile: "../skycloud__inet/bin/skycloud-inet.js",
    serviceModule: "../skycloud__inet/src/service.js",
  },
  "tencent-qyweixin-group-robot": {
    entryFile: "../tencent__qyweixin-group-robot/bin/tencent-qyweixin-group-robot.js",
    serviceModule: "../tencent__qyweixin-group-robot/src/service.js",
  },
  "tencent-tix-saas": {
    entryFile: "../tencent__tix-saas/bin/tencent-tix-saas.js",
    serviceModule: "../tencent__tix-saas/src/service.js",
  },
  "tencent-tsec-v2-5-1": {
    entryFile: "../tencent__tsec_v2-5-1/bin/tencent-tsec-v2-5-1.js",
    serviceModule: "../tencent__tsec_v2-5-1/src/service.js",
  },
  "telegram-bot-api": {
    entryFile: "../telegram__bot-api/bin/telegram-bot-api.js",
    serviceModule: "../telegram__bot-api/src/service.js",
  },
  "threatbook-cloudapi-v3": {
    entryFile: "../threatbook__cloudapi_v3/bin/threatbook-cloudapi-v3.js",
    serviceModule: "../threatbook__cloudapi_v3/src/service.js",
  },
  "threatbook-claudsandbox-v3": {
    entryFile: "../threatbook__claudsandbox_v3/bin/threatbook-claudsandbox-v3.js",
    serviceModule: "../threatbook__claudsandbox_v3/src/service.js",
  },
  "threatbook-ngtip-v5": {
    entryFile: "../threatbook__ngtip_v5/bin/threatbook-ngtip-v5.js",
    serviceModule: "../threatbook__ngtip_v5/src/service.js",
  },
  "threatbook-onesig": {
    entryFile: "../threatbook__onesig/bin/threatbook-onesig.js",
    serviceModule: "../threatbook__onesig/src/service.js",
  },
  "threatbook-tdp": {
    entryFile: "../threatbook__tdp/bin/threatbook-tdp.js",
    serviceModule: "../threatbook__tdp/src/service.js",
  },
  "threatbook-tip-v4": {
    entryFile: "../threatbook__tip_v4/bin/threatbook-tip-v4.js",
    serviceModule: "../threatbook__tip_v4/src/service.js",
  },
  "topsec-waf-v3-2294-20238": {
    entryFile: "../topsec__waf_v3-2294-20238/bin/topsec-waf-v3-2294-20238.js",
    serviceModule: "../topsec__waf_v3-2294-20238/src/service.js",
  },
  "topsec-fw-2u": {
    entryFile: "../topsec__fw-2u/bin/topsec-fw-2u.js",
    serviceModule: "../topsec__fw-2u/src/service.js",
  },
  "topsec-fw-5u": {
    entryFile: "../topsec__fw-5u/bin/topsec-fw-5u.js",
    serviceModule: "../topsec__fw-5u/src/service.js",
  },
  "topsec-fw-v3-7-6": {
    entryFile: "../topsec__fw_v3-7-6/bin/topsec-fw-v3-7-6.js",
    serviceModule: "../topsec__fw_v3-7-6/src/service.js",
  },
  "venus-ads-v3-6": {
    entryFile: "../venus__ads_v3-6/bin/venus-ads-v3-6.js",
    serviceModule: "../venus__ads_v3-6/src/service.js",
  },
  "volcengine-cloud-firewall": {
    entryFile: "../volcengine__cloud-firewall/bin/volcengine-cloud-firewall.js",
    serviceModule: "../volcengine__cloud-firewall/src/service.js",
  },
  "wangsu-label-ip": {
    entryFile: "../wangsu__label-ip/bin/wangsu-label-ip.js",
    serviceModule: "../wangsu__label-ip/src/service.js",
  },
  "wd-k01": {
    entryFile: "../wd__k01/bin/wd-k01.js",
    serviceModule: "../wd__k01/src/service.js",
  },
  "tencent-bh": {
    entryFile: "../tencent__bh/bin/tencent-bh.js",
    serviceModule: "../tencent__bh/src/service.js",
  },
  "alibaba-sas": {
    entryFile: "../alibaba__sas/bin/alibaba-sas.js",
    serviceModule: "../alibaba__sas/src/service.js",
  },
  "misp": {
    entryFile: "../misp__misp/bin/misp.js",
    serviceModule: "../misp__misp/src/service.js",
  },
  "opencti": {
    entryFile: "../filigran__opencti/bin/opencti.js",
    serviceModule: "../filigran__opencti/src/service.js",
  },
};

const serviceNames = Object.keys(services);

const program = new Command();

program
  .name("octobus-tentacles")
  .usage("<service> [args]")
  .description("Run a service from this package")
  .argument("[service]", "service name")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .addHelpText("after", `
Services:
${serviceNames.map((name) => `  ${name.padEnd(37)}`).join("\n")}

Use 'octobus-tentacles <service> --help' to print service help.`)
  .action(async (serviceName) => {
    if (!serviceName) {
      program.outputHelp();
      return;
    }

    const selected = services[serviceName];
    if (!selected) {
      process.stderr.write(`Unknown service: ${serviceName}\n\n`);
      program.outputHelp({ error: true });
      process.exitCode = 1;
      return;
    }

    const { service } = await import(new URL(selected.serviceModule, import.meta.url));

    await runServiceMain(service, {
      argv: program.args.slice(1),
      entryFile: fileURLToPath(new URL(selected.entryFile, import.meta.url)),
    });
  });

await program.parseAsync();
