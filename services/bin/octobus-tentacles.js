#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { Command } from "commander";

const services = {
  "huawei-ccm": {
    entryFile: "../huawei__ccm/bin/huawei-ccm.js",
    serviceModule: "../huawei__ccm/src/service.js",
  },
  "jumpserver-bastionhost-v4-10-16": {
    entryFile: "../jumpserver__bastionhost_v4-10-16/bin/jumpserver-bastionhost-v4-10-16.js",
    serviceModule: "../jumpserver__bastionhost_v4-10-16/src/service.js",
  },
  "cisa-kev": {
    entryFile: "../cisa__kev/bin/cisa-kev.js",
    serviceModule: "../cisa__kev/src/service.js",
  },
  "shodan-internetdb": {
    entryFile: "../shodan__internetdb/bin/shodan-internetdb.js",
    serviceModule: "../shodan__internetdb/src/service.js",
  },
  "alienvault-otx": {
    entryFile: "../alienvault__otx/bin/alienvault-otx.js",
    serviceModule: "../alienvault__otx/src/service.js",
  },
  "dbappsecurity-mingyu-waf": {
    entryFile: "../dbappsecurity__mingyu-waf/bin/dbappsecurity-mingyu-waf.js",
    serviceModule: "../dbappsecurity__mingyu-waf/src/service.js",
  },
  "epp-360": {
    entryFile: "../360__360-epp_v10-0-0-08331/bin/360-epp.js",
    serviceModule: "../360__360-epp_v10-0-0-08331/src/service.js",
  },
  "ailpha-platform": {
    entryFile: "../ailpha__platform/bin/ailpha-platform.js",
    serviceModule: "../ailpha__platform/src/service.js",
  },
  "aliyun-waf3": {
    entryFile: "../aliyun__waf3/bin/aliyun-waf3.js",
    serviceModule: "../aliyun__waf3/src/service.js",
  },
  "alibaba-cloud-simple-application-server-firewall": {
    entryFile: "../alibaba-cloud__simple-application-server-firewall/bin/alibaba-cloud-simple-application-server-firewall.js",
    serviceModule: "../alibaba-cloud__simple-application-server-firewall/src/service.js",
  },
  "aliyun-cloudfw": {
    entryFile: "../aliyun__cloudfw/bin/aliyun-cloudfw.js",
    serviceModule: "../aliyun__cloudfw/src/service.js",
  },
  "answer-platform": {
    entryFile: "../chaitin__answer-platform_v25-05-001/bin/answer-platform.js",
    serviceModule: "../chaitin__answer-platform_v25-05-001/src/service.js",
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
  "cosmos": {
    entryFile: "../chaitin__cosmos/bin/cosmos.js",
    serviceModule: "../chaitin__cosmos/src/service.js",
  },
  "aliyun-sas-vulnerability-management": {
    entryFile: "../aliyun__sas-vulnerability-management/bin/aliyun-sas-vulnerability-management.js",
    serviceModule: "../aliyun__sas-vulnerability-management/src/service.js",
  },
  "das-apt": {
    entryFile: "../das__apt/bin/das-apt.js",
    serviceModule: "../das__apt/src/service.js",
  },
  "ctyun-accessone": {
    entryFile: "../ctyun__accessone/bin/ctyun-accessone.js",
    serviceModule: "../ctyun__accessone/src/service.js",
  },
  "cloudwalker": {
    entryFile: "../chaitin__cloudwalker/bin/cloudwalker.js",
    serviceModule: "../chaitin__cloudwalker/src/service.js",
  },
  "t-answer-ndr": {
    entryFile: "../chaitin__t-answer-ndr/bin/t-answer-ndr.js",
    serviceModule: "../chaitin__t-answer-ndr/src/service.js",
  },
  "baiduwaf-waf-web-template": {
    entryFile: "../baiduwaf__waf-web-template/bin/baiduwaf-waf-web-template.js",
    serviceModule: "../baiduwaf__waf-web-template/src/service.js",
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
  "dsensor": {
    entryFile: "../chaitin__dsensor_ds-s_h_40-25.07.001/bin/dsensor.js",
    serviceModule: "../chaitin__dsensor_ds-s_h_40-25.07.001/src/service.js",
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
  "f5-awaf": {
    entryFile: "../f5__awaf/bin/f5-awaf.js",
    serviceModule: "../f5__awaf/src/service.js",
  },
  "feishu-group-robot": {
    entryFile: "../feishu__group-robot/bin/feishu-group-robot.js",
    serviceModule: "../feishu__group-robot/src/service.js",
  },
  "first-epss-v1": {
    entryFile: "../first__epss-v1/bin/first-epss-v1.js",
    serviceModule: "../first__epss-v1/src/service.js",
  },
  "fofa-network-space-mapper": {
    entryFile: "../fofa__network-space-mapper/bin/fofa-network-space-mapper.js",
    serviceModule: "../fofa__network-space-mapper/src/service.js",
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
  "huawei-dns": {
    entryFile: "../huawei__dns/bin/huawei-dns.js",
    serviceModule: "../huawei__dns/src/service.js",
  },
  "huorong-endpoint-security-management-system-v2-0-19-3": {
    entryFile: "../huorong__endpoint-security-management-system_v2-0-19-3/bin/huorong-endpoint-security-management-system-v2-0-19-3.js",
    serviceModule: "../huorong__endpoint-security-management-system_v2-0-19-3/src/service.js",
  },
  "huawei-waf": {
    entryFile: "../huawei__waf/bin/huawei-waf.js",
    serviceModule: "../huawei__waf/src/service.js",
  },
  "huawei-fw-usg6000e": {
    entryFile: "../huawei__fw-usg6000e/bin/huawei-fw-usg6000e.js",
    serviceModule: "../huawei__fw-usg6000e/src/service.js",
  },
  "imperva-waf-gateway-v13-6-90": {
    entryFile: "../imperva__waf-gateway_v13-6-90/bin/imperva-waf-gateway-v13-6-90.js",
    serviceModule: "../imperva__waf-gateway_v13-6-90/src/service.js",
  },
  "m01-intelligence": {
    entryFile: "../m01__intelligence/bin/m01-intelligence.js",
    serviceModule: "../m01__intelligence/src/service.js",
  },
  "nsfocus-ads-v4-5-r90-f06": {
    entryFile: "../nsfocus__ads_v4-5-r90-f06/bin/nsfocus-ads-v4-5-r90-f06.js",
    serviceModule: "../nsfocus__ads_v4-5-r90-f06/src/service.js",
  },
  "nsfocus-ngfw-v60-9900": {
    entryFile: "../nsfocus__ngfw_v60-9900/bin/nsfocus-ngfw-v60-9900.js",
    serviceModule: "../nsfocus__ngfw_v60-9900/src/service.js",
  },
  "nsfocus-nips-v5-6-r11": {
    entryFile: "../nsfocus__nips_v5-6-r11/bin/nsfocus-nips-v5-6-r11.js",
    serviceModule: "../nsfocus__nips_v5-6-r11/src/service.js",
  },
  "nsfocus-rsas-v6-0r04f04sp09": {
    entryFile: "../nsfocus__rsas_v6-0r04f04sp09/bin/nsfocus-rsas-v6-0r04f04sp09.js",
    serviceModule: "../nsfocus__rsas_v6-0r04f04sp09/src/service.js",
  },
  "owasp-dependency-track-sca-v5-0": {
    entryFile: "../owasp__dependency-track-sca_v5-0/bin/owasp-dependency-track-sca-v5-0.js",
    serviceModule: "../owasp__dependency-track-sca_v5-0/src/service.js",
  },
  "panabit-tang-r1": {
    entryFile: "../panabit__tang-r1/bin/panabit-tang-r1.js",
    serviceModule: "../panabit__tang-r1/src/service.js",
  },
  "qianxin-cloudlock-v8-0-8": {
    entryFile: "../qianxin__cloudlock_v8-0-8/bin/qianxin-cloudlock-v8-0-8.js",
    serviceModule: "../qianxin__cloudlock_v8-0-8/src/service.js",
  },
  "qianxin-fw-secgate3600": {
    entryFile: "../qianxin__fw-secgate3600/bin/qianxin-fw-secgate3600.js",
    serviceModule: "../qianxin__fw-secgate3600/src/service.js",
  },
  "qianxin-tianyan-platform": {
    entryFile: "../qianxin__tianyan-platform/bin/qianxin-tianyan-platform.js",
    serviceModule: "../qianxin__tianyan-platform/src/service.js",
  },
  "qianxin-fw-secgate3600-http-x": {
    entryFile: "../qianxin__fw-secgate3600-http-x/bin/qianxin-fw-secgate3600-http-x.js",
    serviceModule: "../qianxin__fw-secgate3600-http-x/src/service.js",
  },
  "qianxin-hunter": {
    entryFile: "../qianxin__hunter_v23-1/bin/qianxin-hunter.js",
    serviceModule: "../qianxin__hunter_v23-1/src/service.js",
  },
  "qianxin-vs-secvss3600": {
    entryFile: "../qianxin__vs-secvss3600/bin/qianxin-vs-secvss3600.js",
    serviceModule: "../qianxin__vs-secvss3600/src/service.js",
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
  "reportedip": {
    entryFile: "../reportedip__reportedip/bin/reportedip.js",
    serviceModule: "../reportedip__reportedip/src/service.js",
  },
  "ray-waf-v6-1-2": {
    entryFile: "../ray__waf_v6-1-2/bin/ray-waf-v6-1-2.js",
    serviceModule: "../ray__waf_v6-1-2/src/service.js",
  },
  "riversec-waf-26-03": {
    entryFile: "../riversec__waf_26-03/bin/riversec-waf-26-03.js",
    serviceModule: "../riversec__waf_26-03/src/service.js",
  },
  "riversafe-waf": {
    entryFile: "../riversafe__waf/bin/riversafe-waf.js",
    serviceModule: "../riversafe__waf/src/service.js",
  },
  "ruijie-behavior-firewall-r2-3-2-t0": {
    entryFile: "../ruijie__behavior_firewall_r2-3-2-t0/bin/ruijie-behavior-firewall-r2-3-2-t0.js",
    serviceModule: "../ruijie__behavior_firewall_r2-3-2-t0/src/service.js",
  },
  "sangfor-af-v8-0-35r1": {
    entryFile: "../sangfor__af_v8-0-35r1/bin/sangfor-af-v8-0-35r1.js",
    serviceModule: "../sangfor__af_v8-0-35r1/src/service.js",
  },
  "sangfor-fw-v8-0-45": {
    entryFile: "../sangfor__fw_v8-0-45/bin/sangfor-fw-v8-0-45.js",
    serviceModule: "../sangfor__fw_v8-0-45/src/service.js",
  },
  "sangfor-sip": {
    entryFile: "../sangfor__sip/bin/sangfor-sip.js",
    serviceModule: "../sangfor__sip/src/service.js",
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
  "lighthouse-firewall": {
    entryFile: "../tencent__lighthouse-firewall/bin/tencent-lighthouse-firewall.js",
    serviceModule: "../tencent__lighthouse-firewall/src/service.js",
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
  "tencent-cfw": {
    entryFile: "../tencent__cfw/bin/tencent-cfw.js",
    serviceModule: "../tencent__cfw/src/service.js",
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
  "threatbook-tdp-host": {
    entryFile: "../threatbook__tdp-host/bin/threatbook-tdp-host.js",
    serviceModule: "../threatbook__tdp-host/src/service.js",
  },
  "threatbook-tip-v4": {
    entryFile: "../threatbook__tip_v4/bin/threatbook-tip-v4.js",
    serviceModule: "../threatbook__tip_v4/src/service.js",
  },
  "tophant-xsiem": {
    entryFile: "../tophant__xsiem/bin/tophant-xsiem.js",
    serviceModule: "../tophant__xsiem/src/service.js",
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
  "topsec-edr": {
    entryFile: "../topsec__edr/bin/topsec-edr.js",
    serviceModule: "../topsec__edr/src/service.js",
  },
  "venus-ads-v3-6": {
    entryFile: "../venus__ads_v3-6/bin/venus-ads-v3-6.js",
    serviceModule: "../venus__ads_v3-6/src/service.js",
  },
  "leadsec-tam": {
    entryFile: "../leadsec__tam/bin/leadsec-tam.js",
    serviceModule: "../leadsec__tam/src/service.js",
  },
  "venus-maf": {
    entryFile: "../venus__maf/bin/venus-maf.js",
    serviceModule: "../venus__maf/src/service.js",
  },
  "volcengine-cloud-firewall": {
    entryFile: "../volcengine__cloud-firewall/bin/volcengine-cloud-firewall.js",
    serviceModule: "../volcengine__cloud-firewall/src/service.js",
  },
  "volcengine-waf": {
    entryFile: "../volcengine__waf/bin/volcengine-waf.js",
    serviceModule: "../volcengine__waf/src/service.js",
  },
  "leadsec-waf": {
    entryFile: "../leadsec__waf/bin/leadsec-waf.js",
    serviceModule: "../leadsec__waf/src/service.js",
  },
  "venus-ips-v6079": {
    entryFile: "../venus__ips_v6079/bin/venus-ips-v6079.js",
    serviceModule: "../venus__ips_v6079/src/service.js",
  },
  "venus-tar": {
    entryFile: "../venus__tar/bin/venus-tar.js",
    serviceModule: "../venus__tar/src/service.js",
  },
  "wangsu-label-ip": {
    entryFile: "../wangsu__label-ip/bin/wangsu-label-ip.js",
    serviceModule: "../wangsu__label-ip/src/service.js",
  },
  "wd-k01": {
    entryFile: "../wd__k01/bin/wd-k01.js",
    serviceModule: "../wd__k01/src/service.js",
  },
  "threatbook-hfish": {
    entryFile: "../threatbook__hfish/bin/threatbook-hfish.js",
    serviceModule: "../threatbook__hfish/src/service.js",
  },
  "dbappsecurity-mingyu-waf": {
    entryFile: "../dbappsecurity__mingyu-waf/bin/dbappsecurity-mingyu-waf.js",
    serviceModule: "../dbappsecurity__mingyu-waf/src/service.js",
  },
  "opencti": {
    entryFile: "../filigran__opencti/bin/opencti.js",
    serviceModule: "../filigran__opencti/src/service.js",
  },
  "tencent-weixin-personal": {
    entryFile: "../tencent__weixin-personal/bin/tencent-weixin-personal.js",
    serviceModule: "../tencent__weixin-personal/src/service.js",
  },
  "tencent-qq-chat": {
    entryFile: "../tencent__qq-chat/bin/tencent-qq-chat.js",
    serviceModule: "../tencent__qq-chat/src/service.js",
  },
  "geyecloud-atd": {
    entryFile: "../geyecloud__atd_v2-3-6/bin/geyecloud-atd.js",
    serviceModule: "../geyecloud__atd_v2-3-6/src/service.js",
  },
  "nsfocus-waf-v6-0-7": {
    entryFile: "../nsfocus__waf_v6-0-7/bin/nsfocus-waf-v6-0-7.js",
    serviceModule: "../nsfocus__waf_v6-0-7/src/service.js",
  },
  "zhizhangyi-mbs": {
    entryFile: "../zhizhangyi__mbs/bin/zhizhangyi-mbs.js",
    serviceModule: "../zhizhangyi__mbs/src/service.js",
  },
  "qianxin-caasm": {
    entryFile: "../qianxin__caasm_v1/bin/qianxin-caasm.js",
    serviceModule: "../qianxin__caasm_v1/src/service.js",
  },
  "anyi-cloud-native-security": {
    entryFile: "../anyi__cloud-native-security/bin/anyi-cloud-native-security.js",
    serviceModule: "../anyi__cloud-native-security/src/service.js",
  },
  "api7-enterprise-v3-10-2": {
    entryFile: "../api7__enterprise_v3-10-2/bin/api7-enterprise-v3-10-2.js",
    serviceModule: "../api7__enterprise_v3-10-2/src/service.js",
  },
  "qianxin-skyeye-v3-0-14-0": {
    entryFile: "../qianxin__skyeye_v3.0.14.0/bin/qianxin-skyeye-v3-0-14-0.js",
    serviceModule: "../qianxin__skyeye_v3.0.14.0/src/service.js",
  },
  "ctdsg-fw": {
    entryFile: "../ctdsg__fw/bin/ctdsg-fw.js",
    serviceModule: "../ctdsg__fw/src/service.js",
  },
  "tencent-ssl": {
    entryFile: "../tencent__ssl/bin/tencent-ssl.js",
    serviceModule: "../tencent__ssl/src/service.js",
  },
  "tencent-bh": {
    entryFile: "../tencent__bh/bin/tencent-bh.js",
    serviceModule: "../tencent__bh/src/service.js",
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
