# InsertAccessControl payload 填写说明

文件：`insert-access-control.payload.example.json`

适用命令：

```bash
cd /Users/lishengming/workspace/OctoBus && node services/scripts/accessone-verify.mjs --protocol grpc --rpc InsertAccessControl --allow-write --insert-payload-file services/ctyun__accessone/examples/insert-access-control.payload.example.json
```

字段说明

| 字段 | 必填 | 示例 | 说明 |
|---|---|---|---|
| `domains` | 是 | `[
  "test-jzb.ctcdn.cn"
]` | 规则作用域名，可多个 |
| `product_code` | 是 | `020` | AccessOne 产品代码 |
| `configs[].mod` | 是 | `ON` / `CLOSE` | 规则开关 |
| `configs[].act` | 是 | `LOG` / `ACCEPT` / `BLOCK` / `DROP` / `CHECK` / `JUMP` / `JCJS` / `PIC` | 处置动作 |
| `configs[].rule_name` | 是 | `block_bad_ip` | 规则名称 |
| `configs[].rule_desc` | 否 | `block suspicious source ip` | 规则描述 |
| `configs[].jump_url` | 条件必填 | `https://example.com/deny.html` | 仅 `act=JUMP` 时需要 |
| `configs[].public_range` | 是 | 见下 | 匹配条件数组 |

`public_range` 结构语义

| 字段 | 必填 | 示例 | 说明 |
|---|---|---|---|
| `zone` | 是 | `IP` / `GEO` / `URI` / `REQUEST_URI` / `HEADER` / `ARGS` / `FMT_TIME` | 匹配维度 |
| `equal` | 是 | `TRUE` / `FALSE` | 匹配或取反 |
| `public_content` | 多数场景必填 | `1.2.3.4` | 匹配内容；`HEADER/ARGS/GEO` 走扩展字段 |
| `operator` | 否 | `REGEX` / `STR` | 某些 `zone` 生效 |
| `key_name` | 否 | `STR` | `zone=HEADER/ARGS` 常见 |
| `key_content` | 否 | `X-Forwarded-For` | `zone=HEADER/ARGS` 常见 |
| `value_name` | 否 | `STR` | `zone=HEADER/ARGS` 常见 |
| `value_content` | 否 | `10.0.0.1` | `zone=HEADER/ARGS` 常见 |
| `geo_zone` | 条件必填 | `[{"sub_geo":["EU","EU_DE"]}]` | 仅 `zone=GEO` 时需要 |
| `date_period` | 条件必填 | `day` / `week` / `month` | 仅 `zone=FMT_TIME` 时需要 |

最常见的一种：按源 IP 阻断

```json
{
  "zone": "IP",
  "equal": "TRUE",
  "public_content": "1.2.3.4"
}
```

Header 匹配示例

```json
{
  "zone": "HEADER",
  "equal": "TRUE",
  "key_name": "STR",
  "key_content": "X-Forwarded-For",
  "value_name": "STR",
  "value_content": "10.0.0.1"
}
```

Geo 匹配示例

```json
{
  "zone": "GEO",
  "equal": "TRUE",
  "geo_zone": [
    {
      "sub_geo": ["EU", "EU_DE"]
    }
  ]
}
```

注意
- 这个文件现在是“真实规则占位模板”，不再是 demo 规则。
- `DENY`/`OFF`/双重嵌套 `items[]` 都是旧模型，不要再用。
- 真正执行前，请把域名、动作、匹配条件全部换成真实业务值。
- 如果你只是联调取证，不要改这个文件，直接用 `--demo-rule`。
