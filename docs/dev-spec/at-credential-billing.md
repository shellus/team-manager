# AT 凭证权限范围和账单信息提取

本文件记录 ChatGPT Web access token（下称 Web AT）访问账单相关 backend-api 时的权限边界、接口组合和字段提取规则。结论来自脱敏实测，用于后续实现个人套餐账单读取、Workspace 账单刷新和上游协议排查。

> Web AT 是 ChatGPT Web Session 中的 OAuth access token，通常是 JWT。它不是 Codex personal access token（PAT）；即使两者都可能保存在名为 `access_token` 的字段中，也不能混用。
>
> 实测日期为 2026-07-28。ChatGPT Web backend-api 不是项目可控制的稳定协议；路径、权限和响应字段发生变化时，应重新抓取并更新本文。

## 核心结论

- 上游请求的核心输入是 Web `access_token` 和目标 `account_id`。Web AT 放入 `Authorization: Bearer`，`account_id` 同时作为 `chatgpt-account-id` 请求头以及接口要求的查询参数或路径参数。
- `account_id` 的账号类型决定权限范围。个人 `structure="personal"` 账号可以读取历史账单、付款方式和账单资料，但不能读取 Workspace 下期账单或席位统计。
- `401 Must use workspace account for this operation` 表示目标 `account_id` 不是 Workspace，不能通过补充请求字段解决。
- 当前 `getBillingSnapshotRaw()` 聚合 5 个接口，是 team-manager 为完整 Workspace 账单快照选择的组合，不是上游要求每次账单查询必须调用 5 个接口。
- 只提取个人套餐账单时使用 `invoices`、`payment_methods` 和 `billing_info` 即可。`invoices/upcoming` 与 `seat_type_counts` 属于 Workspace 语义。

## 凭证与账号上下文

### 必需输入

| 输入 | 用途 | 约束 |
|---|---|---|
| `access_token` | `Authorization: Bearer <web_access_token>` | 必须是 ChatGPT Web AT，不能使用 Codex PAT |
| `account_id` | 账号上下文 | 必须是当前 Web AT 在 `accounts/check` 中可见的目标账号 |

team-manager 还会发送以下浏览器请求上下文，以保持现有 ChatGPT Web 请求形态：

- `oai-device-id`
- `oai-session-id`
- `x-openai-target-path`
- `x-openai-target-route`
- curl_cffi 浏览器 TLS 和 User-Agent 模拟

这些字段有助于稳定传输，但不会把个人账号转换成 Workspace，也不会扩大 Web AT 的远端权限。

### 账号类型确认

在读取账单前，应先调用：

```http
GET /backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480
```

从响应中找到 `account_id` 对应条目，并读取：

| 字段 | 说明 |
|---|---|
| `account.account_id` | 当前可见账号或 Workspace ID |
| `account.plan_type` | 例如 `prolite`、`team`、`self_serve_business_usage_based` |
| `account.structure` | `personal` 或 `workspace` |
| `account.account_user_role` | 例如 `account-owner`、`account-admin` |
| `can_access_with_session` | 当前 Session 是否可访问该上下文 |

一次个人 Pro Lite 实测返回 `plan_type="prolite"`、`structure="personal"`、`account_user_role="account-owner"`，且 Session 只可见这一个个人账号。该上下文能读取个人账单，但不能执行 Workspace 专属查询。

## 账单相关接口

| 数据 | 方法与路径 | 个人账号 | Workspace | 当前用途 |
|---|---|---:|---:|---|
| 历史账单 | `GET /backend-api/invoices?limit=10&account_id={account_id}` | 已实测可用 | 可用 | 历史发票、金额、折扣、税务和订阅 metadata |
| 下期账单 | `GET /backend-api/invoices/upcoming?account_id={account_id}` | `401` | 可用；无下期账单时可能返回缺失语义 | 判断当前 recurring Team 订阅和预计金额 |
| 付款方式 | `GET /backend-api/payments/payment_methods?account_id={account_id}` | 已实测可用 | 可用 | 默认付款方式与付款方式摘要 |
| 账单资料 | `GET /backend-api/payments/billing_info?account_id={account_id}` | 已实测可用 | 可用 | 账单姓名、邮箱、地址和税号 |
| 席位统计 | `GET /backend-api/accounts/{account_id}/users/seat_type_counts` | `401` | 可用 | `default`、`usage_based` 与 `prolite` 当前席位数量 |

以上接口均为 `GET`，没有请求体。所有请求仍应携带：

```http
Authorization: Bearer <web_access_token>
chatgpt-account-id: {account_id}
```

前四个接口在查询参数中再次传递 `account_id`；席位统计接口把它放在 URL 路径中。

## 权限实测矩阵

个人 Pro Lite Web AT 与其匹配的个人 `account_id` 实测结果如下：

| 接口 | HTTP 状态 | 结果 |
|---|---:|---|
| `invoices` | `200` | 返回 `{data, has_more}`，本次包含 1 条账单 |
| `invoices/upcoming` | `401` | `Must use workspace account for this operation` |
| `payment_methods` | `200` | 返回付款方式配置和列表 |
| `billing_info` | `200` | 返回账单资料 |
| `seat_type_counts` | `401` | `Must use workspace account for this operation` |

因此，Web AT 有效且 `account_id` 匹配，不代表该上下文拥有 Workspace 权限。权限判断必须同时考虑 `accounts/check` 返回的 `structure` 和具体接口响应。

## `invoices` 数据结构

顶层结构：

```json
{
  "data": [
    {
      "account_country": "US",
      "currency": "sgd",
      "customer_address": {
        "country": "SG"
      },
      "discount": {
        "coupon": {},
        "promotion_code": null
      },
      "discounts": [],
      "lines": {
        "data": [
          {
            "metadata": {
              "billing_details_country": "SG",
              "billing_details_currency": "SGD",
              "request_country": "SG",
              "user_facing_promo_code": "stb",
              "individual_restore_promo_code": "stb"
            },
            "discount_amounts": []
          }
        ]
      },
      "total_discount_amounts": [],
      "total_pretax_credit_amounts": [],
      "total_tax_amounts": []
    }
  ],
  "has_more": false
}
```

示例只保留与字段解释有关的脱敏片段。金额、Stripe 对象 ID、姓名、邮箱和完整地址不得写入源码文档。

### 优惠码与折扣提取

优惠信息应按以下顺序读取：

1. `data[].lines.data[].metadata.user_facing_promo_code`：面向用户展示的优惠码。
2. `data[].lines.data[].metadata.individual_restore_promo_code`：恢复或续订流程记录的优惠码。
3. `data[].discount.coupon`：Stripe coupon 详情，可能包含 `name`、`amount_off`、`percent_off`、`duration`、`valid` 等字段。
4. `data[].lines.data[].discount_amounts[]`：行项目实际折扣。
5. `data[].total_discount_amounts[]` 与 `total_pretax_credit_amounts[]`：整张发票的折扣与税前抵扣。

实测样本中：

- `user_facing_promo_code` 为 `stb`。
- `individual_restore_promo_code` 为 `stb`。
- `discount.coupon` 存在。
- `discount.promotion_code` 为 `null`。
- 行项目折扣与发票总折扣数组均存在。

因此，不能只检查 `discount.promotion_code`。该字段为 `null` 时，metadata 和 coupon 仍可能明确表明优惠已经应用。`stb` 仅为实测样本，不得写死为业务规则。

### 国家与币种提取

| 字段路径 | 含义 | 实测值 |
|---|---|---|
| `data[].customer_address.country` | 发票客户账单国家 | `SG` |
| `data[].lines.data[].metadata.billing_details_country` | Checkout 使用的账单国家 | `SG` |
| `data[].lines.data[].metadata.request_country` | 创建订单时的请求国家 | `SG` |
| `data[].currency` | 发票结算币种 | `sgd` |
| `data[].lines.data[].metadata.billing_details_currency` | Checkout 账单币种 | `SGD` |
| `data[].account_country` | Stripe/OpenAI 商户账号国家上下文 | `US` |

`account_country` 不是付款人国家，也不能用来判断用户、银行卡或账单地址所在国家。个人账单国家优先使用 `billing_info.address.country`，并用 invoice 中的 `customer_address.country` 和 `billing_details_country` 交叉验证。

国家字段只能说明请求或账单资料上下文，不能推断用户国籍、实际所在地或银行卡发行国家。

## `payment_methods` 数据结构

个人 Pro Lite 实测响应顶层包含：

```json
{
  "backup_payment_method_enabled": false,
  "default_payment_method_id": "<redacted>",
  "one_click_trial_eligible": false,
  "payment_methods": []
}
```

本次响应中没有 `country` 或 `address` 字段，也没有优惠信息。因此：

- 付款方式接口不作为优惠码来源。
- 付款方式接口不作为账单国家的稳定来源。
- 卡品牌、后四位、付款方式 ID 等字段属于敏感账单数据，只能保存在私有运行数据或受控 UI 中。

## `billing_info` 数据结构

个人 Pro Lite 实测响应结构：

```json
{
  "name": "<redacted>",
  "email": "<redacted>",
  "address": {
    "city": "<redacted>",
    "country": "SG",
    "line1": "<redacted>",
    "line2": "<redacted>",
    "postal_code": "<redacted>",
    "state": "<redacted>"
  },
  "tax_id": "<redacted-or-null>"
}
```

`billing_info.address.country` 是账单资料国家的首选字段。完整响应包含个人身份和地址信息，不应原样返回到普通列表接口，也不得进入 Git 管理的测试夹具或文档。

## 账号类型与接口选择

建议先根据 `accounts/check` 分类，再选择接口集合：

```text
accounts/check
  ├─ structure=personal
  │    ├─ invoices
  │    ├─ payment_methods
  │    └─ billing_info
  └─ structure=workspace
       ├─ invoices
       ├─ invoices/upcoming
       ├─ payment_methods
       ├─ billing_info
       └─ seat_type_counts
```

如果目标只是判断 Workspace 是否存在当前 Team 月付订阅，优先读取 `invoices/upcoming`，不需要加载付款方式和完整账单资料。如果目标只是展示个人套餐历史账单，则不要调用 Workspace 专属接口。

## 当前实现边界

`apps/server/src/chatgptApi.ts` 的 `getBillingSnapshotRaw()` 当前依次请求 5 个接口，并返回：

```ts
{
  invoices,
  upcomingInvoice,
  paymentMethods,
  billingInfo,
  seatTypeCounts
}
```

除“下期账单不存在”被转换为 `upcomingInvoice: null` 外，其他请求失败会终止整次刷新。因此使用个人 `account_id` 调用现有 Workspace 账单刷新时，即使 `invoices` 已成功，也会在 `invoices/upcoming` 返回 `401` 后失败。

如果后续正式支持个人套餐账单，接口实现应根据 `structure` 选择请求集合，或按子请求保存部分成功结果；不能把 Workspace 的 5 接口聚合直接复用于个人账号。

## 错误判断

| 现象 | 含义 | 处理 |
|---|---|---|
| `401 Must use workspace account for this operation` | 当前 `account_id` 是个人账号 | 停止调用 Workspace 专属接口；不要补字段重试 |
| `401 token_invalidated` / `token_revoked` | Web AT 已失效或撤销 | 使用保存的 Session Token 换取目标账号 Web AT 后重试一次 |
| `accounts/check` 找不到目标 `account_id` | Web AT 与目标上下文不匹配，或账号不可见 | 禁止猜测或替换 ID，重新取得目标账号 Session |
| `invoices/upcoming` 返回缺失语义 | 当前没有可读取的下期发票 | Workspace 账单快照保存为 `upcomingInvoice: null` |
| `payment_methods` 没有地址字段 | 当前响应结构不提供付款国家 | 使用 `billing_info` 和 invoice 字段判断 |

## 数据安全

- Web AT、refresh token、Session Token、邮箱、真实 `account_id`、付款方式 ID、完整地址和税号不得写入源码仓库。
- 原始账单响应只允许保存在私有运行数据和上游原始追踪中，并沿用目录 `0700`、文件 `0600` 权限。
- 普通 API 和 UI 应使用明确的字段白名单返回账单摘要，不应透传完整 Stripe/ChatGPT 响应。
- 日志和错误信息不得输出 Authorization 值。调试时只记录接口路径、状态码、账号类型和脱敏字段结构。

## 相关文档

- [ChatGPT Backend API Captures](./chatgpt-backend-api/README.md)
- [数据模型与本地缓存规则](./data-model)
- [Team 账号、席位与凭证基本规则](../core/seat-and-credential-model)
