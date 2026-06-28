#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import process from 'node:process';
import { Command } from 'commander';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICES_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVICES_DIR, '..');
const PROTO_PATH = path.join(SERVICES_DIR, 'ctyun__accessone', 'proto', 'ctyun_accessone.proto');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, '.temp', 'octobus-accessone-manual-proof', 'results');

const READ_RPCS = [
  'QueryDomainList',
  'QueryServiceDetail',
  'QueryDomainRuleAct',
  'QueryDomainRuleConfig',
  'QueryWafConfig',
  'QueryAccessControlSwitch',
  'QueryResourcePackages',
  'QueryIPv6NoSupLink',
];

const WRITE_RPCS = [
  'InsertAccessControl',
  'UpdateAccessControlSwitch',
  'UpdateAccessControlSwitchRestoreCurrent',
  'QueryAccessControlSwitchAfterRestore',
];

const GROUPS = {
  smoke: ['QueryDomainList', 'QueryAccessControlSwitch', 'QueryIPv6NoSupLink'],
  reads: READ_RPCS,
  writes: ['QueryAccessControlSwitch', 'InsertAccessControl', 'UpdateAccessControlSwitch', 'UpdateAccessControlSwitchRestoreCurrent', 'QueryAccessControlSwitchAfterRestore'],
};

const ALL_CASES = [
  ...READ_RPCS,
  'InsertAccessControl',
  'UpdateAccessControlSwitch',
  'UpdateAccessControlSwitchRestoreCurrent',
  'QueryAccessControlSwitchAfterRestore',
];

function nowCompact() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeName(s) {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function parseMaybeJson(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeConnectEnvelope(httpStatus, rawText) {
  const parsed = parseMaybeJson(rawText);
  const outer = parsed && typeof parsed === 'object' ? parsed : { rawText };
  const innerRaw = outer.httpBody ?? outer.http_body ?? '';
  const inner = parseMaybeJson(innerRaw);
  return {
    transportHttpStatus: httpStatus,
    outer,
    innerRaw,
    inner,
  };
}

function normalizeGrpcEnvelope(responseObj) {
  const outer = responseObj && typeof responseObj === 'object' ? responseObj : { raw: responseObj };
  const transportHttpStatus = outer.httpStatus ?? outer.http_status ?? null;
  const innerRaw = outer.httpBody ?? outer.http_body ?? '';
  const inner = parseMaybeJson(innerRaw);
  return {
    transportHttpStatus,
    outer,
    innerRaw,
    inner,
  };
}

function summarize(inner, outer, transportHttpStatus) {
  const businessCode = inner?.code ?? inner?.statusCode ?? null;
  const message = inner?.message ?? outer?.message ?? null;
  return { transportHttpStatus, businessCode, message };
}

function isWriteCase(caseName) {
  return ['InsertAccessControl', 'UpdateAccessControlSwitch', 'UpdateAccessControlSwitchRestoreCurrent'].includes(caseName);
}

function readJsonObjectFile(filePath, label) {
  const absolutePath = path.resolve(filePath);
  let rawText;
  try {
    rawText = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(`${label}: failed to read ${absolutePath}: ${error.message}`);
  }

  const parsed = parseMaybeJson(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}: JSON root must be an object: ${absolutePath}`);
  }
  return { absolutePath, parsed };
}

function normalizeInsertGeoZoneItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('InsertAccessControl geo_zone item must be an object');
  }
  const out = { ...item };
  if (out.subGeo === undefined && out.sub_geo !== undefined) out.subGeo = out.sub_geo;
  return out;
}

function normalizeInsertRangeItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('InsertAccessControl public_range item must be an object');
  }
  const out = { ...item };
  if (out.publicContent === undefined && out.public_content !== undefined) out.publicContent = out.public_content;
  if (out.keyName === undefined && out.key_name !== undefined) out.keyName = out.key_name;
  if (out.keyContent === undefined && out.key_content !== undefined) out.keyContent = out.key_content;
  if (out.valueName === undefined && out.value_name !== undefined) out.valueName = out.value_name;
  if (out.valueContent === undefined && out.value_content !== undefined) out.valueContent = out.value_content;
  if (out.datePeriod === undefined && out.date_period !== undefined) out.datePeriod = out.date_period;
  if (out.geoZone === undefined && out.geo_zone !== undefined) out.geoZone = out.geo_zone;
  if (Array.isArray(out.geoZone)) out.geoZone = out.geoZone.map(normalizeInsertGeoZoneItem);
  return out;
}

function normalizeInsertRangeEntry(entry) {
  if (Array.isArray(entry?.items)) {
    return entry.items.map(normalizeInsertRangeItem);
  }
  if (Array.isArray(entry)) {
    return entry.map(normalizeInsertRangeItem);
  }
  return [normalizeInsertRangeItem(entry)];
}

function normalizeInsertAccessControlRequest(requestBody) {
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    throw new Error('InsertAccessControl request body must be an object');
  }
  const out = { ...requestBody };
  if (out.productCode === undefined && out.product_code !== undefined) out.productCode = out.product_code;
  if (out.configs !== undefined && !Array.isArray(out.configs)) {
    throw new Error('InsertAccessControl configs must be an array');
  }
  if (Array.isArray(out.configs)) {
    out.configs = out.configs.map((config) => {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('InsertAccessControl config must be an object');
      }
      const next = { ...config };
      if (next.ruleName === undefined && next.rule_name !== undefined) next.ruleName = next.rule_name;
      if (next.ruleDesc === undefined && next.rule_desc !== undefined) next.ruleDesc = next.rule_desc;
      if (next.jumpUrl === undefined && next.jump_url !== undefined) next.jumpUrl = next.jump_url;
      if (next.publicRange === undefined && next.public_range !== undefined) next.publicRange = next.public_range;
      if (Array.isArray(next.publicRange)) {
        next.publicRange = next.publicRange.flatMap(normalizeInsertRangeEntry);
      }
      return next;
    });
  }
  return out;
}

function resolveInsertAccessControlRequest(opts, fallback) {
  if (opts.insertPayloadFile) {
    const { absolutePath, parsed } = readJsonObjectFile(opts.insertPayloadFile, '--insert-payload-file');
    return {
      requestBody: normalizeInsertAccessControlRequest(parsed),
      meta: {
        payloadSource: 'file',
        insertPayloadFile: absolutePath,
      },
    };
  }

  if (!opts.demoRule) {
    throw new Error('InsertAccessControl requires either --insert-payload-file <json> or --demo-rule. Refusing to create an implicit demo rule.');
  }

  return {
    requestBody: {
      domains: [fallback.domain],
      productCode: fallback.productCode,
      configs: [{
        mod: 'ON',
        act: 'LOG',
        ruleName: fallback.ruleName,
        publicRange: [{
          zone: 'IP',
          equal: 'true',
          publicContent: '192.0.2.1',
        }],
      }],
    },
    meta: {
      payloadSource: 'demo',
      ruleName: fallback.ruleName,
      note: 'built-in proof-only demo rule uses TEST-NET-1 IP 192.0.2.1',
    },
  };
}

function buildCase(caseName, opts, state) {
  const domain = opts.domain;
  const productCode = opts.product;
  const requestId = Number(opts.requestId);
  const switchMod = opts.switchMod;
  const ruleName = opts.ruleName || `manual_verify_${nowCompact()}`;
  const status = opts.status === '' ? undefined : Number(opts.status);
  const areaScope = opts.areaScope === '' ? undefined : Number(opts.areaScope);
  const page = opts.page === '' ? undefined : Number(opts.page);
  const pageSize = opts.pageSize === '' ? undefined : Number(opts.pageSize);
  const domainSpecified = Boolean(opts.domainSpecified);
  const productSpecified = Boolean(opts.productSpecified);

  switch (caseName) {
    case 'QueryDomainList': {
      const requestBody = {};
      if (domainSpecified && domain) requestBody.domain = domain;
      if (productSpecified && productCode) requestBody.productCode = productCode;
      if (Number.isInteger(status)) requestBody.status = status;
      if (Number.isInteger(areaScope)) requestBody.areaScope = areaScope;
      if (Number.isInteger(page)) requestBody.page = page;
      if (Number.isInteger(pageSize)) requestBody.pageSize = pageSize;
      return { caseName, rpcMethod: 'QueryDomainList', requestBody };
    }
    case 'QueryServiceDetail':
      return { caseName, rpcMethod: 'QueryServiceDetail', requestBody: { productCode: [productCode] } };
    case 'QueryDomainRuleAct':
      return { caseName, rpcMethod: 'QueryDomainRuleAct', requestBody: { domain, productCode } };
    case 'QueryDomainRuleConfig':
      return { caseName, rpcMethod: 'QueryDomainRuleConfig', requestBody: { domain, productCode } };
    case 'QueryWafConfig':
      return { caseName, rpcMethod: 'QueryWafConfig', requestBody: { domain, productCode } };
    case 'QueryAccessControlSwitch':
      return { caseName, rpcMethod: 'QueryAccessControlSwitch', requestBody: { domain, productCode } };
    case 'QueryResourcePackages':
      return { caseName, rpcMethod: 'QueryResourcePackages', requestBody: {} };
    case 'QueryIPv6NoSupLink':
      return { caseName, rpcMethod: 'QueryIPv6NoSupLink', requestBody: { requestId } };
    case 'InsertAccessControl': {
      const insertCase = resolveInsertAccessControlRequest(opts, { domain, productCode, ruleName });
      return {
        caseName,
        rpcMethod: 'InsertAccessControl',
        requestBody: insertCase.requestBody,
        meta: insertCase.meta,
      };
    }
    case 'UpdateAccessControlSwitch':
      return { caseName, rpcMethod: 'UpdateAccessControlSwitch', requestBody: { domain, productCode, mod: switchMod } };
    case 'UpdateAccessControlSwitchRestoreCurrent':
      return {
        caseName,
        rpcMethod: 'UpdateAccessControlSwitch',
        requestBody: { domain, productCode, mod: state.currentMod || 'ON' },
      };
    case 'QueryAccessControlSwitchAfterRestore':
      return { caseName, rpcMethod: 'QueryAccessControlSwitch', requestBody: { domain, productCode } };
    default:
      throw new Error(`Unknown case: ${caseName}`);
  }
}

async function invokeConnect(addr, capset, instance, rpcMethod, requestBody) {
  const url = `http://${addr}/capsets/${capset}/connect/${instance}/Ctyun_AccessOne.Ctyun_AccessOne/${rpcMethod}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-octobus-ext-business-request-id': `manual-proof-${Date.now()}`,
    },
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  return {
    endpoint: url,
    httpStatus: response.status,
    rawText: text,
    ...normalizeConnectEnvelope(response.status, text),
  };
}

async function createGrpcClient(addr) {
  const packageDefinition = await protoLoader.load(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition);
  const ServiceCtor = loaded.Ctyun_AccessOne?.Ctyun_AccessOne;
  if (!ServiceCtor) {
    throw new Error('Failed to load gRPC service constructor for Ctyun_AccessOne.Ctyun_AccessOne');
  }
  return new ServiceCtor(addr, grpc.credentials.createInsecure());
}

function toGrpcRequest(rpcMethod, requestBody) {
  if (rpcMethod === 'QueryDomainList') {
    const out = {};
    if (requestBody.domain !== undefined) out.domain = { value: requestBody.domain };
    if (requestBody.productCode !== undefined) out.productCode = { value: requestBody.productCode };
    if (requestBody.status !== undefined) out.status = { value: requestBody.status };
    if (requestBody.areaScope !== undefined) out.areaScope = { value: requestBody.areaScope };
    if (requestBody.page !== undefined) out.page = { value: requestBody.page };
    if (requestBody.pageSize !== undefined) out.pageSize = { value: requestBody.pageSize };
    return out;
  }

  if (rpcMethod === 'InsertAccessControl' && Array.isArray(requestBody?.configs)) {
    return {
      ...requestBody,
      configs: requestBody.configs.map((config) => ({
        ...config,
        publicRange: Array.isArray(config.publicRange)
          ? config.publicRange.flatMap((item) => (Array.isArray(item?.items) ? item.items : [item]))
          : config.publicRange,
      })),
    };
  }

  return requestBody;
}

async function invokeGrpc(client, addr, capset, instance, rpcMethod, requestBody) {
  const metadata = new grpc.Metadata();
  metadata.set('x-octobus-capset', capset);
  metadata.set('x-octobus-instance', instance);
  metadata.set('x-octobus-ext-business-request-id', `manual-proof-${Date.now()}`);
  const method = promisify(client[rpcMethod].bind(client));
  const response = await method(toGrpcRequest(rpcMethod, requestBody), metadata);
  return {
    endpoint: `${addr} :: Ctyun_AccessOne.Ctyun_AccessOne/${rpcMethod}`,
    ...normalizeGrpcEnvelope(response),
  };
}

function resolveSelectedCases(opts) {
  const selected = [];
  for (const group of opts.group) {
    if (!GROUPS[group]) {
      throw new Error(`Unknown group: ${group}`);
    }
    selected.push(...GROUPS[group]);
  }
  for (const rpc of opts.rpc) {
    selected.push(rpc);
  }
  const ordered = [];
  const seen = new Set();
  const source = selected.length ? selected : GROUPS.smoke;
  for (const item of source) {
    if (!ALL_CASES.includes(item)) {
      throw new Error(`Unknown --rpc value: ${item}. Use --list-rpcs to see allowed values.`);
    }
    if (!seen.has(item)) {
      seen.add(item);
      ordered.push(item);
    }
  }
  return ordered;
}

function validateOptions(opts, selectedCases) {
  const protocols = opts.protocol.length ? opts.protocol : ['connect'];
  for (const protocol of protocols) {
    if (!['connect', 'grpc'].includes(protocol)) {
      throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }
  const hasWrite = selectedCases.some(isWriteCase);
  if (hasWrite && !opts.allowWrite) {
    throw new Error('Write cases selected but --allow-write not provided.');
  }
  if (selectedCases.includes('UpdateAccessControlSwitch') && !opts.switchMod) {
    throw new Error('UpdateAccessControlSwitch requires --switch-mod ON|CLOSE');
  }
  if (selectedCases.includes('InsertAccessControl')) {
    if (opts.demoRule && opts.insertPayloadFile) {
      throw new Error('InsertAccessControl accepts either --demo-rule or --insert-payload-file <json>, not both.');
    }
    if (!opts.demoRule && !opts.insertPayloadFile) {
      throw new Error('InsertAccessControl requires --insert-payload-file <json> for real rules, or --demo-rule for proof-only testing.');
    }
  }
  return protocols;
}

function printBanner(opts, protocols, selectedCases, outDir) {
  console.log('=== AccessOne OctoBus Manual Proof Runner ===');
  console.log(`addr      : ${opts.addr}`);
  console.log(`capset    : ${opts.capset}`);
  console.log(`instance  : ${opts.instance}`);
  console.log(`protocols : ${protocols.join(', ')}`);
  console.log(`cases     : ${selectedCases.join(', ')}`);
  console.log(`outDir    : ${outDir}`);
  console.log('');
}

function printCaseResult(protocol, caseName, result) {
  const summary = summarize(result.inner, result.outer, result.transportHttpStatus);
  console.log(`--- [${protocol}] ${caseName} ---`);
  console.log(`endpoint          : ${result.endpoint}`);
  console.log(`transport_status  : ${summary.transportHttpStatus}`);
  console.log(`business_code     : ${summary.businessCode ?? ''}`);
  console.log(`message           : ${summary.message ?? ''}`);
  if (result.inner) {
    console.log('inner_json        :');
    console.log(JSON.stringify(result.inner, null, 2));
  } else if (result.innerRaw) {
    console.log('inner_raw         :');
    console.log(result.innerRaw);
  } else {
    console.log('outer_json        :');
    console.log(JSON.stringify(result.outer, null, 2));
  }
  console.log('');
}

function persistResult(baseDir, protocol, caseName, payload) {
  ensureDir(baseDir);
  const filePath = path.join(baseDir, `${safeName(protocol)}-${safeName(caseName)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

async function main() {
  const program = new Command();
  program
    .option('--protocol <protocol>', 'connect | grpc (repeatable)', (value, prev) => [...prev, value], [])
    .option('--rpc <name>', 'specific rpc/case name (repeatable)', (value, prev) => [...prev, value], [])
    .option('--group <group>', 'smoke | reads | writes (repeatable)', (value, prev) => [...prev, value], [])
    .option('--allow-write', 'allow write-side effect cases', false)
    .option('--addr <addr>', 'OctoBus public address', '127.0.0.1:19101')
    .option('--capset <id>', 'OctoBus capset id', 'esa-demo')
    .option('--instance <id>', 'OctoBus instance id', 'accessone-test')
    .option('--domain <domain>', 'domain filter; for QueryDomainList only takes effect when explicitly passed', 'test-jzb.ctcdn.cn')
    .option('--product <code>', 'product filter; for QueryDomainList only takes effect when explicitly passed', '020')
    .option('--status <status>', 'QueryDomainList status filter (explicit filter)', '')
    .option('--area-scope <scope>', 'QueryDomainList area scope filter: 1=国内 2=海外 3=全球', '')
    .option('--page <n>', 'QueryDomainList page number (default 1)', '1')
    .option('--page-size <n>', 'QueryDomainList page size (default 50)', '50')
    .option('--request-id <id>', 'IPv6 request id', '20266')
    .option('--switch-mod <mod>', 'ON | CLOSE for UpdateAccessControlSwitch direct case', 'CLOSE')
    .option('--rule-name <name>', 'demo rule name override for InsertAccessControl when --demo-rule is used', '')
    .option('--demo-rule', 'explicitly use the built-in proof-only InsertAccessControl demo payload (192.0.2.1)', false)
    .option('--insert-payload-file <path>', 'JSON file for InsertAccessControl request body (preferred for real rules)', '')
    .option('--out-dir <dir>', 'result output directory', DEFAULT_OUT_DIR)
    .option('--list-rpcs', 'list supported case names and exit', false)
    .parse(process.argv);

  const opts = program.opts();
  opts.domainSpecified = process.argv.some((arg) => arg === '--domain' || arg.startsWith('--domain='));
  opts.productSpecified = process.argv.some((arg) => arg === '--product' || arg.startsWith('--product='));
  if (opts.listRpcs) {
    console.log(JSON.stringify({
      groups: GROUPS,
      cases: ALL_CASES,
      notes: {
        queryDomainListBehavior: 'QueryDomainList without explicit --domain/--product enumerates all domains visible to current AK/SK; pass --domain/--product to query a specific domain.',
        insertAccessControlBehavior: 'InsertAccessControl now refuses implicit demo writes: use --insert-payload-file <json> for real rules, or --demo-rule for proof-only demo payload.',
        directWriteRpc: 'Use --rpc UpdateAccessControlSwitch with --switch-mod ON|CLOSE',
        restoreCase: 'Use pseudo-case UpdateAccessControlSwitchRestoreCurrent to restore pre-query state',
      },
    }, null, 2));
    return;
  }

  const selectedCases = resolveSelectedCases(opts);
  const protocols = validateOptions(opts, selectedCases);
  const runDir = path.join(path.resolve(opts.outDir), nowCompact());
  printBanner(opts, protocols, selectedCases, runDir);

  const state = {};
  const summaryRows = [];
  let grpcClient = null;
  if (protocols.includes('grpc')) {
    grpcClient = await createGrpcClient(opts.addr);
  }

  for (const protocol of protocols) {
    for (const caseName of selectedCases) {
      const built = buildCase(caseName, opts, state);
      const executor = protocol === 'connect'
        ? invokeConnect(opts.addr, opts.capset, opts.instance, built.rpcMethod, built.requestBody)
        : invokeGrpc(grpcClient, opts.addr, opts.capset, opts.instance, built.rpcMethod, built.requestBody);
      const result = await executor;
      const payload = {
        protocol,
        caseName,
        rpcMethod: built.rpcMethod,
        requestBody: built.requestBody,
        meta: built.meta || {},
        result,
      };
      const outputPath = persistResult(runDir, protocol, caseName, payload);
      const summary = summarize(result.inner, result.outer, result.transportHttpStatus);
      if (caseName === 'QueryAccessControlSwitch' && result.inner?.data?.mod) {
        state.currentMod = result.inner.data.mod;
      }
      summaryRows.push({
        protocol,
        caseName,
        transportStatus: summary.transportHttpStatus,
        businessCode: summary.businessCode,
        outputPath,
      });
      printCaseResult(protocol, caseName, result);
    }
  }

  const summaryFile = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summaryRows, null, 2), 'utf8');

  console.log('=== Summary ===');
  for (const row of summaryRows) {
    console.log(`[${row.protocol}] ${row.caseName} -> transport=${row.transportStatus} business=${row.businessCode ?? ''} file=${row.outputPath}`);
  }
  console.log(`summary_file: ${summaryFile}`);
  console.log(`octobus_logs: ./bin/octobus --addr ${opts.addr} logs --capset ${opts.capset} --instance ${opts.instance} --tail 20`);
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
