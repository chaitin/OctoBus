#!/usr/bin/env node
/**
 * 钉钉云盘（DingTalk Drive）— OctoBus 服务包入口
 *
 * 封装 dws drive CLI 的所有操作：
 * - 文件上传（UploadFile）
 * - 文件下载（DownloadFile）
 * - 文件列表（ListFiles）
 * - 空间列表（ListSpaces）
 * - 文件元信息（GetFileInfo）
 * - 文件夹管理（CreateFolder / DeleteFile）
 * - 文档空间上传（UploadToDocSpace）
 *
 * 设计原则：
 * - 每个 RPC 对应一次或多次 dws CLI 调用
 * - 统一错误处理和超时控制
 * - camelCase/snake_case 双兼容（OctoBus 可能传 camelCase）
 */

import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';
import { execFile } from 'child_process';

// ─── dws CLI 封装 ───

function runDws(command, timeout = 120000) {
  const dwsPath = process.env.DWS_PATH || 'dws';
  return new Promise((resolve) => {
    execFile('sh', ['-c', `${dwsPath} ${command} --yes --format json`], { timeout, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout) => {
        const raw = stdout.trim();
        let data = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        if (error && error.code !== 0) resolve({ success: false, data, error: error.message });
        else resolve({ success: true, data, error: '' });
      });
  });
}

const shellEscape = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// ─── 兼容字段提取 ───

const get = (r, ...keys) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return undefined;
};

// ─── 服务定义 ───

const service = defineService({
  handlers: {

    // ====== 上传文件到云盘 ======
    'dingtalk.drive.v1.DriveService/UploadFile': async (ctx) => {
      const r = ctx.request;
      const filePath = get(r, 'filePath', 'file_path');
      const fileName = get(r, 'fileName', 'file_name');
      const spaceId  = get(r, 'spaceId', 'space_id') || process.env.DEFAULT_SPACE_ID || '';
      const folderId = get(r, 'folderId', 'folder_id');
      const mimeType = get(r, 'mimeType', 'mime_type');

      if (!filePath) return { success: false, error: 'filePath is required' };

      let cmd = `drive upload --file ${shellEscape(filePath)}`;
      if (fileName)  cmd += ` --file-name ${shellEscape(fileName)}`;
      if (spaceId)   cmd += ` --space-id ${shellEscape(spaceId)}`;
      if (folderId)  cmd += ` --folder ${shellEscape(folderId)}`;
      if (mimeType)  cmd += ` --mime-type ${shellEscape(mimeType)}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, error: res.error };

      const d = res.data || {};
      return {
        success: true,
        dentryId: d.dentryId || d.dentry_id || d.nodeId || '',
        fileUrl: d.url || d.fileUrl || d.file_url || '',
        error: '',
      };
    },

    // ====== 下载文件 ======
    'dingtalk.drive.v1.DriveService/DownloadFile': async (ctx) => {
      const r = ctx.request;
      const dentryId   = get(r, 'dentryId', 'dentry_id');
      const outputPath = get(r, 'outputPath', 'output_path');

      if (!dentryId)    return { success: false, error: 'dentryId is required' };
      if (!outputPath)  return { success: false, error: 'outputPath is required' };

      const cmd = `drive download --node ${shellEscape(dentryId)} --output ${shellEscape(outputPath)}`;
      const res = await runDws(cmd);
      if (!res.success) return { success: false, error: res.error };

      const d = res.data || {};
      return {
        success: true,
        localPath: d.localPath || d.local_path || outputPath,
        fileSize: d.size || d.fileSize || d.file_size || 0,
        error: '',
      };
    },

    // ====== 列出文件 ======
    'dingtalk.drive.v1.DriveService/ListFiles': async (ctx) => {
      const r = ctx.request;
      const spaceId   = get(r, 'spaceId', 'space_id') || process.env.DEFAULT_SPACE_ID || '';
      const folderId  = get(r, 'folderId', 'folder_id');
      const maxResults = get(r, 'maxResults', 'max_results') || 20;
      const nextToken = get(r, 'nextToken', 'next_token');

      let cmd = `drive list`;
      if (spaceId)   cmd += ` --space-id ${shellEscape(spaceId)}`;
      if (folderId)  cmd += ` --folder ${shellEscape(folderId)}`;
      if (maxResults) cmd += ` --max-results ${maxResults}`;
      if (nextToken)  cmd += ` --next-token ${shellEscape(nextToken)}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, files: [], error: res.error };

      const d = res.data || {};
      const items = (d.items || d.files || d.entries || []);
      const files = items.map(f => ({
        dentryId: f.dentryId || f.dentry_id || f.nodeId || '',
        name: f.name || '',
        type: f.type || (f.isFolder ? 'folder' : 'file'),
        size: f.size || 0,
        updatedAt: f.updatedAt || f.updated_at || f.modifiedTime || '',
        url: f.url || f.fileUrl || '',
      }));

      return {
        success: true,
        files,
        nextToken: d.nextToken || d.next_token || '',
        error: '',
      };
    },

    // ====== 列出空间 ======
    'dingtalk.drive.v1.DriveService/ListSpaces': async (ctx) => {
      const r = ctx.request;
      const spaceType = get(r, 'spaceType', 'space_type');

      let cmd = `drive list-spaces`;
      if (spaceType) cmd += ` --type ${shellEscape(spaceType)}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, spaces: [], error: res.error };

      const d = res.data || {};
      const items = (d.items || d.spaces || d.entries || []);
      const spaces = items.map(s => ({
        spaceId: s.spaceId || s.space_id || s.id || '',
        name: s.name || '',
        type: s.type || s.spaceType || '',
      }));

      return { success: true, spaces, error: '' };
    },

    // ====== 获取文件信息 ======
    'dingtalk.drive.v1.DriveService/GetFileInfo': async (ctx) => {
      const r = ctx.request;
      const dentryId = get(r, 'dentryId', 'dentry_id');

      if (!dentryId) return { success: false, error: 'dentryId is required' };

      const cmd = `drive info --node ${shellEscape(dentryId)}`;
      const res = await runDws(cmd);
      if (!res.success) return { success: false, error: res.error };

      const d = res.data || {};
      return {
        success: true,
        name: d.name || '',
        type: d.type || '',
        size: d.size || 0,
        url: d.url || d.fileUrl || '',
        spaceId: d.spaceId || d.space_id || '',
        createdAt: d.createdAt || d.created_at || d.createTime || '',
        updatedAt: d.updatedAt || d.updated_at || d.modifiedTime || '',
        error: '',
      };
    },

    // ====== 创建文件夹 ======
    'dingtalk.drive.v1.DriveService/CreateFolder': async (ctx) => {
      const r = ctx.request;
      const name           = get(r, 'name');
      const spaceId        = get(r, 'spaceId', 'space_id') || process.env.DEFAULT_SPACE_ID || '';
      const parentFolderId = get(r, 'parentFolderId', 'parent_folder_id');

      if (!name) return { success: false, error: 'name is required' };

      let cmd = `drive mkdir --name ${shellEscape(name)}`;
      if (spaceId)        cmd += ` --space-id ${shellEscape(spaceId)}`;
      if (parentFolderId) cmd += ` --parent ${shellEscape(parentFolderId)}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, error: res.error };

      const d = res.data || {};
      return {
        success: true,
        dentryId: d.dentryId || d.dentry_id || d.nodeId || '',
        error: '',
      };
    },

    // ====== 删除文件 ======
    'dingtalk.drive.v1.DriveService/DeleteFile': async (ctx) => {
      const r = ctx.request;
      const dentryId = get(r, 'dentryId', 'dentry_id');

      if (!dentryId) return { success: false, error: 'dentryId is required' };

      const cmd = `drive delete --node ${shellEscape(dentryId)}`;
      const res = await runDws(cmd);
      return { success: res.success, error: res.error || '' };
    },

    // ====== 上传到文档空间 ======
    'dingtalk.drive.v1.DriveService/UploadToDocSpace': async (ctx) => {
      const r = ctx.request;
      const filePath      = get(r, 'filePath', 'file_path');
      const folderNodeId  = get(r, 'folderNodeId', 'folder_node_id');
      const workspaceId   = get(r, 'workspaceId', 'workspace_id');
      const convert       = get(r, 'convert') || false;

      if (!filePath) return { success: false, error: 'filePath is required' };

      let cmd = `doc upload --file ${shellEscape(filePath)}`;
      if (folderNodeId) cmd += ` --folder ${shellEscape(folderNodeId)}`;
      if (workspaceId)  cmd += ` --workspace ${shellEscape(workspaceId)}`;
      if (convert)      cmd += ` --convert`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, error: res.error };

      const d = res.data || {};
      return {
        success: true,
        nodeId: d.nodeId || d.node_id || d.dentryId || '',
        docUrl: d.docUrl || d.doc_url || d.url || '',
        error: '',
      };
    },
  },
});

runServiceMain(service);
