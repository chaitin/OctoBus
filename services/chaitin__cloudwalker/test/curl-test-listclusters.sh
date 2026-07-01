#!/bin/bash

# CloudWalker ListClusters API 测试命令
# 测试地址: https://cnapp.demo.chaitin.cn
# 测试接口: ListClusters - 获取集群列表

# 认证信息（请替换为实际的认证信息）
TOKEN="<TOKEN>"
COOKIE="<SESSION_COOKIE>; _ga=GA1.1.1297162178.1779286613; _ga_9GZCPX5F2S=GS2.1.s1781158734\$o5\$g1\$t1781158735\$j59\$l0\$h0; Hm_lvt_bdc8a6ca6357aeb139a069c8b93cc42e=1782638516; Hm_lpvt_bdc8a6ca6357aeb139a069c8b93cc42e=1782638516; HMACCOUNT=234FBC9F3102653B; <SESSION_ID>"

# API 端点
URL="https://cnapp.demo.chaitin.cn/cluster/cluster_list?page_size=10"

echo "========================================"
echo "🧪 测试 CloudWalker ListClusters API"
echo "========================================"
echo ""
echo "📤 请求信息:"
echo "  URL: $URL"
echo "  Method: GET"
echo ""

# 执行 curl 测试
curl -X GET "$URL" \
  -H "accept: application/json, text/plain, */*" \
  -H "authorization: Bearer $TOKEN" \
  -H "token: $TOKEN" \
  -H "x-auth-token: $TOKEN" \
  -H "x-requested-with: XMLHttpRequest" \
  -H "cookie: $COOKIE" \
  -H "referer: https://cnapp.demo.chaitin.cn/profile/apitoken" \
  -v \
  | jq '.' 2>/dev/null || cat

echo ""
echo "========================================"
echo "✅ 测试完成"
echo "========================================"