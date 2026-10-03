import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18082);
const log = (...args) => console.log('[mock-zhihu]', ...args);

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer((req, res) => {
  const method = req.method;
  const url = new URL(req.url, 'http://127.0.0.1');

  // Zhihu search
  if (method === 'GET' && url.pathname === '/api/v1/content/zhihu_search') {
    const Query = url.searchParams.get('Query');
    if (!Query) {
      sendJson(res, 200, { Code: 10001, Message: 'Query is required', Data: {} });
      return;
    }
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        HasMore: false,
        SearchHashId: 'search-hash',
        Items: [{
          Title: `结果: ${Query}`,
          ContentType: 'Article',
          ContentID: '123',
          ContentText: '摘要',
          Url: 'https://zhuanlan.zhihu.com/p/123',
          CommentCount: 1,
          VoteUpCount: 2,
          AuthorName: '作者',
          AuthorAvatar: '',
          AuthorBadge: '',
          AuthorBadgeText: '',
          EditTime: 1710000000,
          CommentInfoList: [],
          AuthorityLevel: '2',
          RankingScore: 0.9,
        }],
      },
    });
    log('zhihu_search:', Query);
    return;
  }

  // Global search
  if (method === 'GET' && url.pathname === '/api/v1/content/global_search') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        HasMore: false,
        Items: [{ Title: '全网结果', ContentType: 'Answer', ContentID: '1' }],
      },
    });
    return;
  }

  // Hot list
  if (method === 'GET' && url.pathname === '/api/v1/content/hot_list') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Total: 1,
        Items: [{ Title: '热榜问题', Url: 'https://www.zhihu.com/question/1', ThumbnailUrl: '', Summary: '' }],
      },
    });
    return;
  }

  // Question recommendations (profile mode when Query is absent)
  if (method === 'GET' && url.pathname === '/api/v1/user/question_recommendations') {
    const Query = url.searchParams.get('Query');
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{
          Title: Query ? `推荐问题: ${Query}` : '画像推荐问题',
          Url: 'https://www.zhihu.com/question/123',
        }],
      },
    });
    log('question_recommendations:', Query ?? '(profile)');
    return;
  }

  // Knowledge bases
  if (method === 'GET' && url.pathname === '/api/v1/knowledge/bases') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{ KnowledgeBaseID: 'kb-1', Name: '资料库', Relation: 'created', IsDefault: true, Visibility: 'private', ContentCount: 3, UpdatedAt: 1785902400 }],
      },
    });
    return;
  }

  // Knowledge base items
  if (method === 'GET' && url.pathname.startsWith('/api/v1/knowledge/bases/') && url.pathname.endsWith('/items')) {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{ RecallContentID: 'c1', ContentType: 'file', Title: 'a.pdf', Abstract: '', CreatedAt: 1, UpdatedAt: 2, OriginUrl: '' }],
        Total: 1,
        HasMore: false,
      },
    });
    return;
  }

  // Knowledge file upload
  if (method === 'POST' && url.pathname === '/api/v1/knowledge/files') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!/multipart\/form-data/.test(String(req.headers['content-type'] || '')) || !raw.includes('name="File"')) {
        sendJson(res, 200, { Code: 10001, Message: 'File is required', Data: {} });
        return;
      }
      sendJson(res, 200, {
        Code: 0,
        Message: 'success',
        Data: {
          KnowledgeBaseID: 'kb-1',
          RecallContentID: 'rc-1',
          FileName: 'a.pdf',
          FileSize: raw.length,
          Title: 'a',
          Abstract: '',
          OriginUrl: '',
        },
      });
      log('uploaded file bytes:', raw.length);
    });
    return;
  }

  // Knowledge search
  if (method === 'POST' && url.pathname === '/api/v1/knowledge/search') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {
        sendJson(res, 200, { Code: 10001, Message: 'invalid JSON', Data: {} });
        return;
      }
      if (!body.Query || (!body.KnowledgeBaseIDs?.length && !body.RecallScopes?.length)) {
        sendJson(res, 200, { Code: 10001, Message: 'Query and scopes required', Data: {} });
        return;
      }
      sendJson(res, 200, {
        Code: 0,
        Message: 'success',
        Data: {
          Items: [{ Content: ['片段一'], KnowledgeBaseID: 'kb-1', DocName: '退款规则', RecallContentID: 'rc-1', OriginUrl: '' }],
        },
      });
    });
    return;
  }

  // User contents
  if (method === 'GET' && url.pathname === '/api/v1/user/contents') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{ ContentType: 'answer', Url: 'https://www.zhihu.com/answer/1', CreatedAt: 1, LikeCount: 2, CommentCount: 3, FavoriteCount: 4, Title: '标题', Summary: '摘要' }],
        Paging: { IsEnd: true, NextOffset: '20', Totals: 1 },
      },
    });
    return;
  }

  // User followees
  if (method === 'GET' && url.pathname === '/api/v1/user/followees') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{ Fullname: '关注者', UrlToken: 'token', Url: 'https://www.zhihu.com/people/token', AvatarUrl: '', Headline: '', Gender: 0, FollowerCount: 5 }],
        Paging: { IsEnd: true, NextOffset: '20', Totals: 1 },
      },
    });
    return;
  }

  // User collections
  if (method === 'GET' && url.pathname === '/api/v1/user/collections') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{ ContentType: 'answer', Url: 'https://www.zhihu.com/answer/1', CreatedAt: 1, FavTime: 2, LikeCount: 3, CommentCount: 4, FavoriteCount: 5, Title: '标题', Summary: '摘要', Favlists: [], Author: { Name: 'a', UrlToken: 't', Url: 'u', Gender: 0, Headline: 'h' } }],
      },
    });
    return;
  }

  // User favlists
  if (method === 'GET' && url.pathname === '/api/v1/user/favlists') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{ UrlToken: 123, Url: 'https://www.zhihu.com/collection/123', Title: '收藏夹', Description: '', IsPublic: true }],
      },
    });
    return;
  }

  // Favlist contents
  if (method === 'GET' && url.pathname === '/api/v1/user/favlist_contents') {
    sendJson(res, 200, {
      Code: 0,
      Message: 'success',
      Data: {
        Items: [{ ContentType: 'article', Url: 'https://zhuanlan.zhihu.com/p/1', CreatedAt: 1, FavTime: 2, LikeCount: 3, CommentCount: 4, FavoriteCount: 5, Title: '标题', Summary: '摘要', Favlists: [] }],
        Paging: { IsEnd: true, NextOffset: '20', Totals: 1 },
      },
    });
    return;
  }

  // Quota
  if (method === 'GET' && url.pathname === '/api/v1/quota') {
    const apiIds = url.searchParams.get('APIIDs');
    const all = [
      { APIID: 'global_search', APIName: '全网搜', TotalQuota: 500, TotalUsed: 3, RemainingQuota: 497 },
      { APIID: 'zhihu_search', APIName: '知乎搜索', TotalQuota: 500, TotalUsed: 12, RemainingQuota: 488 },
      { APIID: 'hot_list', APIName: '热榜', TotalQuota: 30, TotalUsed: 30, RemainingQuota: 0 },
      { APIID: 'knowledge', APIName: '知识库', TotalQuota: 500, TotalUsed: 12, RemainingQuota: 488 },
    ];
    const items = apiIds
      ? all.filter((item) => apiIds.split(',').map((s) => s.trim()).includes(item.APIID))
      : all;
    sendJson(res, 200, { Code: 0, Message: 'success', Data: items });
    log('quota:', apiIds ?? 'all');
    return;
  }

  // Auth / error simulation
  if (method === 'GET' && url.pathname === '/api/v1/error/unauthorized') {
    sendJson(res, 200, { Code: 20001, Message: '鉴权失败', Data: {} });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/v1/error/rate-limit') {
    sendJson(res, 429, { Code: 30001, Message: '频率限制', Data: {} });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/v1/error/kb-not-found') {
    sendJson(res, 200, { Code: 40004, Message: '知识库不存在', Data: {} });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/v1/error/invalid-param') {
    sendJson(res, 200, { Code: 10001, Message: '参数错误', Data: {} });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/v1/error/retry') {
    sendJson(res, 200, { Code: 50002, Message: '检索失败', Data: {} });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/v1/error/internal') {
    sendJson(res, 500, { Code: 90001, Message: '内部错误', Data: {} });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () => {
  log(`listening on :${httpPort}`);
});
