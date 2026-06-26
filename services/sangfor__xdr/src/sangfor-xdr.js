// ============ AssetService ============

const assetHandlers = {
  "sangfor_xdr.AssetService/ListAssets": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/v2/asset/assets?_method=GET&page=${req.page || 1}&pageSize=${req.pageSize || 20}${
      req.keyword ? `&keyword=${encodeURIComponent(req.keyword)}` : ""
    }${req.branchIds?.length ? `&branchIds=${req.branchIds.join(",")}` : ""}${req.groupIds?.length ? `&groupIds=${req.groupIds.join(",")}` : ""}${req.ipList?.length ? `&ipList=${req.ipList.join(",")}` : ""}` });
    return { total: r.data?.total ?? 0, page: req.page || 1, pageSize: req.pageSize || 20, items: (r.data?.items ?? r.data?.list ?? []).map(mapAsset) };
  },

  "sangfor_xdr.AssetService/GetAsset": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/v2/asset/assets/${encodeURIComponent(req.assetId)}?_method=GET` });
    return mapAsset(r.data);
  },

  "sangfor_xdr.AssetService/UpdateAsset": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: `/apps/asset/api/v2/asset/assets/${encodeURIComponent(req.assetId)}?_method=PATCH`, body: { name: req.name, description: req.description, groupId: req.groupId, responsiblePerson: req.responsiblePerson } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "" };
  },

  "sangfor_xdr.AssetService/ListBranches": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/v2/asset/branch/get_branch${req.groupId ? `?groupId=${req.groupId}` : ""}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(b => ({ id: b.id ?? b.branchId ?? "", name: b.name ?? b.branchName ?? "", assetCount: b.assetCount ?? b.count ?? 0 })) };
  },

  "sangfor_xdr.AssetService/ListGroups": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/v2/asset/group/get_group${req.groupType ? `?groupType=${req.groupType}` : ""}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(g => ({ id: g.id ?? g.groupId ?? "", name: g.name ?? g.groupName ?? "", type: g.type ?? g.groupType ?? "", assetCount: g.assetCount ?? g.count ?? 0 })) };
  },

  "sangfor_xdr.AssetService/GetAssetStats": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/apps/asset/api/on_asset_statistics?_method=GET" });
    return { total: r.data?.total ?? 0, online: r.data?.online ?? 0, offline: r.data?.offline ?? 0, highRisk: r.data?.highRisk ?? 0, mediumRisk: r.data?.mediumRisk ?? 0, lowRisk: r.data?.lowRisk ?? 0, changes: (r.data?.changes ?? []).map(c => ({ date: c.date ?? "", count: c.count ?? 0 })) };
  },

  "sangfor_xdr.AssetService/GetAssetCard": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/apps/asset/api/v2/asset/get_asset_card" });
    return { total: r.data?.total ?? 0, serverCount: r.data?.serverCount ?? 0, pcCount: r.data?.pcCount ?? 0, networkDeviceCount: r.data?.networkDeviceCount ?? 0, otherCount: r.data?.otherCount ?? 0 };
  },

  "sangfor_xdr.AssetService/GetExposure": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/v2/asset/get_exposure?assetId=${encodeURIComponent(req.assetId)}` });
    return { openPorts: r.data?.openPorts ?? [], openServices: r.data?.openServices ?? [], vulnerabilities: r.data?.vulnerabilities ?? [] };
  },

  "sangfor_xdr.AssetService/ListDevices": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.keyword) params.set("keyword", req.keyword);
    if (req.branchId) params.set("branchId", req.branchId);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/device/branch/dev?${params}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(d => ({ id: d.id ?? d.devId ?? "", name: d.name ?? d.devName ?? "", ip: d.ip ?? d.devIp ?? "", type: d.type ?? d.devType ?? "", status: d.status ?? "", branchName: d.branchName ?? "", assetCount: d.assetCount ?? 0 })) };
  },

  "sangfor_xdr.AssetService/GetDeviceStats": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/api/xdr/v1/device/branch/devstats" });
    return { total: r.data?.total ?? 0, online: r.data?.online ?? 0, offline: r.data?.offline ?? 0, typeCounts: (r.data?.typeCounts ?? []).map(tc => ({ type: tc.type ?? "", count: tc.count ?? 0 })) };
  },

  "sangfor_xdr.AssetService/GetOpenServiceCount": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/apps/asset/api/v2/asset/get_open_service_count" });
    return { count: r.data?.count ?? r.data?.total ?? 0 };
  },

  "sangfor_xdr.AssetService/GetOsStats": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/apps/asset/api/v2/asset/get_os_total_by_group" });
    return { items: (r.data?.items ?? []).map(i => ({ os: i.os ?? i.name ?? "", count: i.count ?? 0 })) };
  },

  "sangfor_xdr.AssetService/GetNewAssetCount": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/apps/asset/api/v2/asset/get_inc_asset_count" });
    return { count: r.data?.count ?? r.data?.total ?? 0 };
  },

  "sangfor_xdr.AssetService/GetActiveAssets": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/apps/asset/api/v2/asset/get_active_asset" });
    return { items: (r.data?.items ?? []).map(mapAsset) };
  },

  "sangfor_xdr.AssetService/GetDeviceClassCount": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/apps/asset/api/v2/asset/get_device_class_count" });
    return { items: (r.data?.items ?? r.data?.counts ?? []).map(dc => ({ type: dc.type ?? dc.name ?? "", count: dc.count ?? 0 })) };
  },

  "sangfor_xdr.AssetService/GetAssetAttributes": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/v2/asset/get_asset_attributes?assetIds=${(req.assetIds ?? []).join(",")}` });
    return { items: (r.data?.items ?? []).map(a => ({ assetId: a.assetId ?? a.id ?? "", attributes: a.attributes ?? a.attrs ?? {} })) };
  },

  "sangfor_xdr.AssetService/ListAssetsV1": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.keyword) params.set("keyword", req.keyword);
    if (req.branchId) params.set("branchId", req.branchId);
    if (req.groupType) params.set("groupType", req.groupType);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/assets?_method=GET&${params}` });
    return { total: r.data?.total ?? 0, page: req.page || 1, pageSize: req.pageSize || 20, items: (r.data?.items ?? r.data?.list ?? []).map(mapAssetV1) };
  },

  "sangfor_xdr.AssetService/GetAssetV1": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/assets/${encodeURIComponent(req.aid)}?_method=GET` });
    return mapAssetV1(r.data);
  },

  "sangfor_xdr.AssetService/GetAssetByOrigin": async (req, ctx) => {
    const params = new URLSearchParams();
    if (req.originDeviceId) params.set("originDeviceId", req.originDeviceId);
    if (req.productName) params.set("productName", req.productName);
    if (req.ip) params.set("ip", req.ip);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/apps/asset/api/v2/asset/get_adapter_by_ip?${params}` });
    return mapAsset(r.data);
  },

  "sangfor_xdr.AssetService/ListAssetsSaaS": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.keyword) params.set("keyword", req.keyword);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v2/asset/assets?_method=GET&${params}` });
    return { total: r.data?.total ?? 0, page: req.page || 1, pageSize: req.pageSize || 20, items: (r.data?.items ?? []).map(mapAsset) };
  },

  "sangfor_xdr.AssetService/GetAssetSaaS": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v2/asset/assets/${encodeURIComponent(req.assetId)}?_method=GET` });
    return mapAsset(r.data);
  },
};

// ============ IncidentService ============

const incidentHandlers = {
  "sangfor_xdr.IncidentService/ListIncidents": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.startTime) params.set("startTime", req.startTime);
    if (req.endTime) params.set("endTime", req.endTime);
    if (req.severity) params.set("severity", req.severity);
    if (req.status) params.set("status", req.status);
    if (req.keyword) params.set("keyword", req.keyword);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/incidents?${params}` });
    return { total: r.data?.total ?? 0, page: req.page || 1, pageSize: req.pageSize || 20, items: (r.data?.items ?? []).map(mapIncident) };
  },

  "sangfor_xdr.IncidentService/ListAlerts": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.startTime) params.set("startTime", req.startTime);
    if (req.endTime) params.set("endTime", req.endTime);
    if (req.severity) params.set("severity", req.severity);
    if (req.status) params.set("status", req.status);
    if (req.assetId) params.set("assetId", req.assetId);
    if (req.keyword) params.set("keyword", req.keyword);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/alerts?${params}` });
    return { total: r.data?.total ?? 0, page: req.page || 1, pageSize: req.pageSize || 20, items: (r.data?.items ?? []).map(mapAlert) };
  },

  "sangfor_xdr.IncidentService/GetAnalysisField": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/analysis/analysisField/${encodeURIComponent(req.uuid)}` });
    return { fields: (r.data?.fields ?? r.data?.items ?? []).map(f => ({ fieldName: f.fieldName ?? f.key ?? "", fieldValue: f.fieldValue ?? f.value ?? "", fieldType: f.fieldType ?? f.type ?? "" })) };
  },

  "sangfor_xdr.IncidentService/GetLogDetail": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/analysis/analysisDetail?uuid=${encodeURIComponent(req.uuid || "")}` });
    return { id: r.data?.id ?? "", logType: r.data?.logType ?? "", timestamp: r.data?.timestamp ?? "", source: r.data?.source ?? "", rawData: r.data?.rawData ?? "", fields: r.data?.fields ?? {} };
  },

  "sangfor_xdr.IncidentService/GetESideLogDetail": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/analysis/eSide/analysisDetail?uuid=${encodeURIComponent(req.uuid || "")}` });
    return { id: r.data?.id ?? "", logType: r.data?.logType ?? "", timestamp: r.data?.timestamp ?? "", source: r.data?.source ?? "", rawData: r.data?.rawData ?? "", fields: r.data?.fields ?? {} };
  },

  "sangfor_xdr.IncidentService/GetAlertLogs": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/analysis/getAnalysisListByAlertId?alertId=${encodeURIComponent(req.alertId)}&page=${req.page || 1}&pageSize=${req.pageSize || 20}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(l => ({ id: l.id ?? "", logType: l.logType ?? "", timestamp: l.timestamp ?? "", source: l.source ?? "", rawData: l.rawData ?? "", fields: l.fields ?? {} })) };
  },

  "sangfor_xdr.IncidentService/GetDisposalStats": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/${encodeURIComponent(req.uuid)}/disposalStatistics` });
    return { totalEntities: r.data?.totalEntities ?? 0, disposed: r.data?.disposed ?? 0, pending: r.data?.pending ?? 0, entities: (r.data?.entities ?? []).map(e => ({ entityType: e.entityType ?? e.type ?? "", entityName: e.entityName ?? e.name ?? "", status: e.status ?? "" })) };
  },

  "sangfor_xdr.IncidentService/GetDisposalTabs": async (req, ctx) => {
    const extra = req.entityType ? `&entityType=${encodeURIComponent(req.entityType)}` : "";
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/${encodeURIComponent(req.uuid)}/disposalTabs${extra}` });
    return { tabs: (r.data?.tabs ?? []).map(t => ({ tabName: t.tabName ?? t.name ?? "", tabType: t.tabType ?? t.type ?? "", entities: (t.entities ?? []).map(e => ({ entityType: e.entityType ?? e.type ?? "", entityName: e.entityName ?? e.name ?? "", status: e.status ?? "" })) })) };
  },

  "sangfor_xdr.IncidentService/GetDisposalAdvices": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/${encodeURIComponent(req.uuid)}/disposalAdvices` });
    return { summary: r.data?.summary ?? "", advices: (r.data?.advices ?? []).map(a => ({ action: a.action ?? "", target: a.target ?? "", description: a.description ?? "", severity: a.severity ?? "" })) };
  },

  "sangfor_xdr.IncidentService/GetIncidentTrend": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/api/xdr/v1/report/incident/analysis" });
    return { points: (r.data?.points ?? r.data?.data ?? []).map(p => ({ date: p.date ?? p.time ?? "", high: p.high ?? 0, medium: p.medium ?? 0, low: p.low ?? 0 })) };
  },
};

// ============ ResponseService ============

const responseHandlers = {
  "sangfor_xdr.ResponseService/BanIP": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/banip", body: { ip: req.ip, reason: req.reason, durationMinutes: req.durationMinutes, deviceIds: req.deviceIds } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/IsolateHost": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/isolatehost", body: { hostIp: req.hostIp, reason: req.reason, deviceIds: req.deviceIds } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/DisposeFile": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/disposefile", body: { fileHash: req.fileHash, filePath: req.filePath, action: req.action, deviceIds: req.deviceIds } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/UntrustFile": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/untrustfile", body: { fileHashes: req.fileHashes, reason: req.reason } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/DispatchScript": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/task", body: { scriptContent: req.scriptContent, deviceIds: req.deviceIds, scriptType: req.scriptType } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/GetTaskStatus": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.taskId) params.set("taskId", req.taskId);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/linkage/action/task/status?${params}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(i => ({ taskId: i.taskId ?? "", deviceName: i.deviceName ?? "", status: i.status ?? "", message: i.message ?? "" })) };
  },

  "sangfor_xdr.ResponseService/GetTaskResult": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/linkage/action/${encodeURIComponent(req.taskId)}` });
    return { taskId: r.data?.taskId ?? req.taskId, status: r.data?.status ?? "", result: r.data?.result ?? r.data?.data ?? "", createTime: r.data?.createTime ?? "", finishTime: r.data?.finishTime ?? "" };
  },

  "sangfor_xdr.ResponseService/GetDisposeFileStatus": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/linkage/disposefile/status?fileHashes=${(req.fileHashes ?? []).join(",")}` });
    return { items: (r.data?.items ?? []).map(i => ({ fileHash: i.fileHash ?? "", status: i.status ?? "", message: i.message ?? "" })) };
  },

  "sangfor_xdr.ResponseService/UnblockIPs": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/unblockips", body: { ips: req.ips, deviceIds: req.deviceIds } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/UnisolateHost": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/unisolatehost", body: { hostIp: req.hostIp, deviceIds: req.deviceIds } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/UnisolateFile": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/linkage/action/unisolatefile", body: { fileHashes: req.fileHashes } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/OneClickDisposeTask": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: `/api/xdr/v1/incidents/${encodeURIComponent(req.uuid)}/oneclickdispose/task`, body: { entityIds: req.entityIds, action: req.action } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/GetDisposeEntities": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incidents/${encodeURIComponent(req.uuid)}/oneclickdispose/entities` });
    return { entities: (r.data?.entities ?? []).map(e => ({ entityId: e.entityId ?? e.id ?? "", entityType: e.entityType ?? e.type ?? "", entityName: e.entityName ?? e.name ?? "", status: e.status ?? "", availableActions: e.availableActions ?? e.actions ?? [] })) };
  },

  "sangfor_xdr.ResponseService/GetLinkageDevices": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incidents/${encodeURIComponent(req.uuid)}/incidentLinkageDevice` });
    return { devices: (r.data?.devices ?? []).map(d => ({ deviceId: d.deviceId ?? d.id ?? "", deviceName: d.deviceName ?? d.name ?? "", deviceType: d.deviceType ?? d.type ?? "", status: d.status ?? "" })) };
  },

  "sangfor_xdr.ResponseService/UnblockEntity": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/incidents/action/unblockEntity", body: { entityIds: req.entityIds, entityType: req.entityType } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ResponseService/PollTask": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/incident/pollTask?taskId=${encodeURIComponent(req.taskId)}` });
    return { taskId: r.data?.taskId ?? req.taskId, status: r.data?.status ?? "", result: r.data?.result ?? r.data?.data ?? "", createTime: r.data?.createTime ?? "", finishTime: r.data?.finishTime ?? "" };
  },

  "sangfor_xdr.ResponseService/WechatPushEvent": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/wechat/event", body: { eventId: req.eventId, content: req.content, recipients: req.recipients } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },
};

// ============ VulnerabilityService ============

const vulnHandlers = {
  "sangfor_xdr.VulnerabilityService/ListWeakPasswords": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.severity) params.set("severity", req.severity);
    if (req.status) params.set("status", req.status);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/asm/risk/sir/list?${params}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(i => ({ id: i.id ?? "", host: i.host ?? "", username: i.username ?? "", password: i.password ?? "", service: i.service ?? "", severity: i.severity ?? "", status: i.status ?? "" })) };
  },

  "sangfor_xdr.VulnerabilityService/GetWeakPasswordProof": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/asm/risk/detail/proof?riskId=${encodeURIComponent(req.riskId)}` });
    return { riskId: r.data?.riskId ?? req.riskId, proofs: (r.data?.proofs ?? []).map(p => ({ key: p.key ?? "", value: p.value ?? "" })) };
  },

  "sangfor_xdr.VulnerabilityService/GetWeakPasswordCommon": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/asm/risk/detail/common?riskId=${encodeURIComponent(req.riskId)}` });
    return { riskId: r.data?.riskId ?? req.riskId, protocol: r.data?.protocol ?? "", port: r.data?.port ?? "", service: r.data?.service ?? "", description: r.data?.description ?? "" };
  },

  "sangfor_xdr.VulnerabilityService/GetWeakPasswordBase": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/asm/risk/detail/base?riskId=${encodeURIComponent(req.riskId)}` });
    return { riskId: r.data?.riskId ?? req.riskId, vulnName: r.data?.vulnName ?? "", cveId: r.data?.cveId ?? "", severity: r.data?.severity ?? "", status: r.data?.status ?? "", detectTime: r.data?.detectTime ?? "", fixTime: r.data?.fixTime ?? "" };
  },

  "sangfor_xdr.VulnerabilityService/ListVulnerabilities": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.severity) params.set("severity", req.severity);
    if (req.status) params.set("status", req.status);
    if (req.assetId) params.set("assetId", req.assetId);
    if (req.keyword) params.set("keyword", req.keyword);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/openapi/risk/list?${params}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(mapVuln) };
  },

  "sangfor_xdr.VulnerabilityService/GetVulnProof": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/openapi/risk/detail/proof?riskId=${encodeURIComponent(req.riskId)}` });
    return { riskId: r.data?.riskId ?? req.riskId, proofs: (r.data?.proofs ?? []).map(p => ({ key: p.key ?? "", value: p.value ?? "" })) };
  },

  "sangfor_xdr.VulnerabilityService/GetVulnCommon": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/openapi/risk/detail/common?riskId=${encodeURIComponent(req.riskId)}` });
    return { riskId: r.data?.riskId ?? req.riskId, protocol: r.data?.protocol ?? "", port: r.data?.port ?? "", description: r.data?.description ?? "" };
  },

  "sangfor_xdr.VulnerabilityService/GetVulnBase": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/openapi/risk/detail/base?riskId=${encodeURIComponent(req.riskId)}` });
    return { riskId: r.data?.riskId ?? req.riskId, vulnName: r.data?.vulnName ?? "", cveId: r.data?.cveId ?? "", severity: r.data?.severity ?? "", status: r.data?.status ?? "" };
  },

  "sangfor_xdr.VulnerabilityService/AggregateVulns": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/outer/risky_assets/aggregation?dimension=${encodeURIComponent(req.dimension || "severity")}&page=${req.page || 1}&pageSize=${req.pageSize || 20}` });
    return { total: r.data?.total ?? 0, groups: (r.data?.groups ?? r.data?.items ?? []).map(g => ({ key: g.key ?? "", count: g.count ?? 0, high: g.high ?? 0, medium: g.medium ?? 0, low: g.low ?? 0 })) };
  },

  "sangfor_xdr.VulnerabilityService/ListRiskyAssets": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.severity) params.set("severity", req.severity);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/outer/risky_assets?${params}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(a => ({ assetId: a.assetId ?? "", assetName: a.assetName ?? "", ip: a.ip ?? "", vulnCount: a.vulnCount ?? 0, riskLevel: a.riskLevel ?? "" })) };
  },

  "sangfor_xdr.VulnerabilityService/ListAssetVulns": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/outer/risky_assets/loopholes?assetId=${encodeURIComponent(req.assetId)}&page=${req.page || 1}&pageSize=${req.pageSize || 20}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(mapVuln) };
  },

  "sangfor_xdr.VulnerabilityService/GetVulnsByPerson": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/order/v1/openapi/risk/risk_by_person?personId=${encodeURIComponent(req.personId)}&page=${req.page || 1}&pageSize=${req.pageSize || 20}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(mapVuln) };
  },

  "sangfor_xdr.VulnerabilityService/GetRiskOverview": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/order/v1/outer/vul_manage/risk/overview" });
    return { total: r.data?.total ?? 0, critical: r.data?.critical ?? 0, high: r.data?.high ?? 0, medium: r.data?.medium ?? 0, low: r.data?.low ?? 0, fixed: r.data?.fixed ?? 0, priorities: (r.data?.priorities ?? []).map(p => ({ priority: p.priority ?? "", count: p.count ?? 0 })) };
  },

  "sangfor_xdr.VulnerabilityService/GetVulnAssetOverview": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/order/v1/outer/vul_manage/vul_asset_overview" });
    return { totalVulns: r.data?.totalVulns ?? 0, affectedAssets: r.data?.affectedAssets ?? 0, fixedVulns: r.data?.fixedVulns ?? 0 };
  },

  "sangfor_xdr.VulnerabilityService/GetVulnAssetTop5": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/api/xdr/v1/vulnerability/asset/top5" });
    return { assets: (r.data?.assets ?? r.data?.items ?? []).map(a => ({ assetId: a.assetId ?? "", assetName: a.assetName ?? "", vulnCount: a.vulnCount ?? 0 })) };
  },
};

// ============ SoarService ============

const soarHandlers = {
  "sangfor_xdr.SoarService/GetDictionary": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/customized/soar/dictionary${req.type ? `?type=${encodeURIComponent(req.type)}` : ""}` });
    return { items: (r.data?.items ?? r.data?.dict ?? []).map(i => ({ key: i.key ?? "", value: i.value ?? "", type: i.type ?? req.type ?? "" })) };
  },

  "sangfor_xdr.SoarService/GetDetail": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/customized/soar/detail?detailType=${encodeURIComponent(req.detailType || "asset")}&id=${encodeURIComponent(req.id)}` });
    return { detailType: r.data?.detailType ?? req.detailType ?? "", id: r.data?.id ?? req.id, rawData: r.data?.rawData ?? r.data?.data ?? JSON.stringify(r.data) };
  },
};

// ============ AuthService ============

const authHandlers = {
  "sangfor_xdr.AuthService/Authorize": async (req, ctx) => {
    const params = new URLSearchParams();
    Object.entries(req || {}).forEach(([k, v]) => params.set(k, String(v)));
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/oauth2/authorize?${params}` });
    return { code: r.data?.code ?? "", state: r.data?.state ?? "", redirectUri: r.data?.redirectUri ?? "" };
  },

  "sangfor_xdr.AuthService/GetToken": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/oauth2/token", body: req || {} });
    return { accessToken: r.data?.accessToken ?? r.data?.access_token ?? "", tokenType: r.data?.tokenType ?? r.data?.token_type ?? "Bearer", expiresIn: r.data?.expiresIn ?? r.data?.expires_in ?? 0, refreshToken: r.data?.refreshToken ?? r.data?.refresh_token ?? "", scope: r.data?.scope ?? "" };
  },

  "sangfor_xdr.AuthService/GetProfile": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/api/xdr/oauth2/profile" });
    return { userId: r.data?.userId ?? r.data?.user_id ?? "", username: r.data?.username ?? "", displayName: r.data?.displayName ?? r.data?.display_name ?? "", email: r.data?.email ?? "", role: r.data?.role ?? "", permissions: r.data?.permissions ?? [] };
  },

  "sangfor_xdr.AuthService/CreateClient": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/oauth2/client", body: req || {} });
    return mapClient(r.data);
  },

  "sangfor_xdr.AuthService/ListClients": async (req, ctx) => {
    const params = new URLSearchParams({ page: String(req.page || 1), pageSize: String(req.pageSize || 20) });
    if (req.keyword) params.set("keyword", req.keyword);
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/oauth2/client/list?${params}` });
    return { total: r.data?.total ?? 0, items: (r.data?.items ?? []).map(mapClient) };
  },

  "sangfor_xdr.AuthService/GetClient": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/oauth2/client/${encodeURIComponent(req.clientId)}` });
    return mapClient(r.data);
  },

  "sangfor_xdr.AuthService/GetClientByName": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/oauth2/client?name=${encodeURIComponent(req.name)}` });
    return mapClient(r.data);
  },

  "sangfor_xdr.AuthService/UpdateClient": async (req, ctx) => {
    const { clientId, ...rest } = req || {};
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: `/api/xdr/v1/oauth2/client/${encodeURIComponent(clientId)}`, body: rest });
    return mapClient(r.data);
  },

  "sangfor_xdr.AuthService/DeleteClient": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "DELETE", path: `/api/xdr/v1/oauth2/client/${encodeURIComponent(req.clientId)}` });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "" };
  },

  "sangfor_xdr.AuthService/GenerateSecret": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: `/api/xdr/v1/oauth2/client/secret/${encodeURIComponent(req.clientId)}`, body: {} });
    return { clientId: r.data?.clientId ?? req.clientId, clientSecret: r.data?.clientSecret ?? r.data?.secret ?? "", createTime: r.data?.createTime ?? "" };
  },

  "sangfor_xdr.AuthService/GetSecret": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: `/api/xdr/v1/oauth2/client/secret/${encodeURIComponent(req.clientId)}` });
    return { clientId: r.data?.clientId ?? req.clientId, secretHint: r.data?.secretHint ?? r.data?.hint ?? "", createTime: r.data?.createTime ?? "", expireTime: r.data?.expireTime ?? "" };
  },

  "sangfor_xdr.AuthService/DeleteSecret": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "DELETE", path: `/api/xdr/v1/oauth2/client/secret/${encodeURIComponent(req.clientId)}` });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "" };
  },
};

// ============ ThreatExpertService ============

const expertHandlers = {
  "sangfor_xdr.ThreatExpertService/PushIncident": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/incident/xth", body: req || {} });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ThreatExpertService/PushReport": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/incident/xthreport", body: req || {} });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ThreatExpertService/ConfirmIncident": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: "/api/xdr/v1/incident/xthconfirm", body: req || {} });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },

  "sangfor_xdr.ThreatExpertService/ListOrderInfos": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/api/xdr/v1/authsrv/orderinfos" });
    return { items: (r.data?.items ?? r.data?.list ?? []).map(o => ({ orderId: o.orderId ?? o.order_id ?? "", productName: o.productName ?? o.product_name ?? "", status: o.status ?? "", startTime: o.startTime ?? o.start_time ?? "", endTime: o.endTime ?? o.end_time ?? "", attributes: o.attributes ?? o.attrs ?? {} })) };
  },

  "sangfor_xdr.ThreatExpertService/GetProductInfo": async (_req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "GET", path: "/api/xdr/v1/productinfo" });
    return { productName: r.data?.productName ?? r.data?.product_name ?? "", version: r.data?.version ?? "", apiVersion: r.data?.apiVersion ?? r.data?.api_version ?? "", serialNumber: r.data?.serialNumber ?? r.data?.serial_number ?? "", features: r.data?.features ?? {} };
  },

  "sangfor_xdr.ThreatExpertService/UpdateDisposeIcon": async (req, ctx) => {
    const r = await signedRequest({ config: ctx.config, secret: ctx.secret, method: "POST", path: `/api/xdr/v1/incidents/${encodeURIComponent(req.uuid)}/oneclickdispose/iconChange`, body: { iconStatus: req.iconStatus } });
    return { success: r.data?.success ?? r.data?.code === 0, message: r.data?.message ?? r.data?.msg ?? "", taskId: r.data?.taskId ?? "" };
  },
};

// ============ Helpers ============

function mapAsset(raw) {
  return {
    id: raw.id ?? raw.assetId ?? raw.aid ?? "",
    name: raw.name ?? raw.hostname ?? raw.computerName ?? "",
    ip: raw.ip ?? raw.ipAddr ?? raw.innerIp ?? "",
    mac: raw.mac ?? raw.macAddr ?? "",
    hostname: raw.hostname ?? raw.computerName ?? raw.name ?? "",
    os: raw.os ?? raw.osType ?? raw.osName ?? "",
    riskLevel: raw.riskLevel ?? raw.risk ?? raw.level ?? "",
    groupName: raw.groupName ?? raw.group?.name ?? "",
    branchName: raw.branchName ?? raw.branch?.name ?? "",
    responsiblePerson: raw.responsiblePerson ?? raw.owner ?? raw.responsible ?? "",
    department: raw.department ?? raw.dept ?? "",
    status: raw.status ?? raw.onlineStatus ?? "",
    lastSeen: raw.lastSeen ?? raw.lastOnlineTime ?? raw.lastScanTime ?? "",
    vulnCount: raw.vulnCount ?? raw.vuln ?? raw.vulnerabilityCount ?? 0,
    alertCount: raw.alertCount ?? raw.alarm ?? raw.alarmCount ?? 0,
  };
}

function mapAssetV1(raw) {
  return {
    id: raw.id ?? raw.aid ?? "",
    name: raw.name ?? raw.hostname ?? "",
    ip: raw.ip ?? raw.innerIp ?? "",
    hostname: raw.hostname ?? raw.name ?? "",
    os: raw.os ?? raw.osType ?? "",
    groupName: raw.groupName ?? raw.group?.name ?? "",
    branchName: raw.branchName ?? raw.branch?.name ?? "",
    responsiblePerson: raw.responsiblePerson ?? raw.owner ?? "",
    department: raw.department ?? raw.dept ?? "",
  };
}

function mapIncident(raw) {
  return {
    uuid: raw.uuid ?? raw.id ?? "",
    name: raw.name ?? raw.title ?? raw.eventName ?? "",
    severity: raw.severity ?? raw.level ?? "",
    status: raw.status ?? raw.state ?? "",
    type: raw.type ?? raw.category ?? "",
    sourceIp: raw.sourceIp ?? raw.srcIp ?? raw.attackerIp ?? "",
    targetIp: raw.targetIp ?? raw.dstIp ?? raw.victimIp ?? "",
    assetName: raw.assetName ?? raw.deviceName ?? raw.host ?? "",
    description: raw.description ?? raw.desc ?? raw.detail ?? "",
    detectTime: raw.detectTime ?? raw.occurTime ?? raw.createTime ?? "",
    handleTime: raw.handleTime ?? raw.disposeTime ?? raw.finishTime ?? "",
    handleResult: raw.handleResult ?? raw.result ?? "",
    analyst: raw.analyst ?? raw.handler ?? raw.expert ?? "",
  };
}

function mapAlert(raw) {
  return {
    id: raw.id ?? raw.alertId ?? "",
    name: raw.name ?? raw.title ?? raw.alertName ?? "",
    severity: raw.severity ?? raw.level ?? "",
    status: raw.status ?? raw.state ?? "",
    sourceIp: raw.sourceIp ?? raw.srcIp ?? "",
    targetIp: raw.targetIp ?? raw.dstIp ?? "",
    assetName: raw.assetName ?? raw.deviceName ?? "",
    description: raw.description ?? raw.desc ?? "",
    detectTime: raw.detectTime ?? raw.occurTime ?? raw.time ?? "",
  };
}

function mapVuln(raw) {
  return {
    id: raw.id ?? raw.riskId ?? raw.vulnId ?? "",
    name: raw.name ?? raw.title ?? raw.vulnName ?? "",
    cveId: raw.cveId ?? raw.cve ?? "",
    severity: raw.severity ?? raw.level ?? "",
    status: raw.status ?? raw.state ?? "",
    assetId: raw.assetId ?? raw.deviceId ?? raw.asset?.id ?? "",
    assetName: raw.assetName ?? raw.deviceName ?? raw.asset?.name ?? "",
    description: raw.description ?? raw.desc ?? raw.detail ?? "",
    solution: raw.solution ?? raw.fix ?? raw.remediation ?? "",
    detectTime: raw.detectTime ?? raw.findTime ?? raw.discoverTime ?? "",
    fixTime: raw.fixTime ?? raw.repairTime ?? raw.resolveTime ?? "",
    responsiblePerson: raw.responsiblePerson ?? raw.owner ?? raw.responsible ?? "",
  };
}

function mapClient(raw) {
  return {
    clientId: raw.clientId ?? raw.client_id ?? raw.id ?? "",
    name: raw.name ?? "",
    description: raw.description ?? raw.desc ?? "",
    redirectUris: raw.redirectUris ?? raw.redirect_uris ?? raw.redirects ?? [],
    grantTypes: raw.grantTypes ?? raw.grant_types ?? [],
    scopes: raw.scopes ?? raw.scope ? [raw.scope] : [],
    status: raw.status ?? raw.state ?? "",
    createTime: raw.createTime ?? raw.create_time ?? raw.created ?? "",
  };
}

// ============ Export ============

import { signedRequest } from "./xdr-client.js";

export const handlers = {
  ...assetHandlers,
  ...incidentHandlers,
  ...responseHandlers,
  ...vulnHandlers,
  ...soarHandlers,
  ...authHandlers,
  ...expertHandlers,
};
