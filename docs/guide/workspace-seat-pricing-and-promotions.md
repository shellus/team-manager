# Workspace 席位计价与优惠码

## 席位类型

Business 固定席位 Checkout 的 `seat_quantities` 明细当前只接受 `default` 与 `prolite`：

| `seat_type` | 页面名称 | 说明 |
| --- | --- | --- |
| `default` | ChatGPT 席位 | 固定 ChatGPT 席位 |
| `usage_based` | Codex 席位 | Workspace/成员中的按用量类型；不属于本 Checkout 的固定席位明细 |
| `prolite` | Premium 席位 | Business Premium 固定席位 |

订单请求同时发送总数 `seat_quantity` 和明细 `seat_quantities[]`。数组中的 `seat_type` 只能是 `default` 或 `prolite`，总数必须等于明细之和；明细中的零数量类型可以保留，以便上游重新计算计价行。`usage_based`/Codex 是独立的按用量 Workspace 产品，不应放进 `chatgptteamplan` 的这组数组。创建 Checkout 后，修改席位数量继续使用上游的 Checkout 更新接口，由上游返回新的计价行和折扣分摊。

旧配置只有 `seatQuantity` 时，Team Manager 会按全部数量归入 `default`，因此旧订单和维护任务仍可运行。Workspace 订单弹窗只填写 ChatGPT、Premium 两类固定席位；历史配置中可能仍存在 `usage_based`，但将其用于 `chatgptteamplan` Checkout 会被上游拒绝。

## 按空间查询优惠码

优惠码的资格和 metadata 不是全局属性，而是绑定请求使用的 `chatgpt-account-id`。同一个账号看到多个 Workspace 时，必须在界面中明确选择查询上下文：

- **个人空间**：调用个人访问上下文，只读查询优惠码资格、套餐、折扣数量、周期和当前个人订阅摘要；不会修改 Workspace 订阅。
- **Workspace**：调用该 Workspace 的活动 owner/admin 访问上下文，查询结果只代表所选空间；若要写入优惠码，仍使用已有的 Workspace 应用流程。

Team Manager API：

```text
POST /api/accounts/:accountId/promotion/lookup
{
  "target": { "kind": "personal" },
  "promoCode": "..."
}

POST /api/accounts/:accountId/promotion/lookup
{
  "target": { "kind": "workspace", "workspaceId": "<Team Manager 本地 UUID>" },
  "promoCode": "..."
}
```

服务端按顺序调用上游：

```text
GET /backend-api/promotions/eligibility/<code>?type=promo
GET /backend-api/promotions/metadata/<code>?type=promo
```

资格接口在生成订单前即可调用；metadata 和订阅摘要只在资格通过时读取。Workspace 应用优惠码可能恢复已关闭的自动续费，因此仍要求用户显式确认；个人空间查询保持只读。

生成 Workspace 订单链接弹窗也提供独立的“检查优惠码”按钮：选择“新开 Workspace”时使用个人空间上下文，选择“升级已有 Workspace”时使用所选 Workspace 上下文。该按钮只读取资格和 metadata，不创建订单；随后仍可按需要提交订单链接。

国家与货币边界：上述优惠码资格、metadata 和 `promo_campaign/check_coupon` 请求本身只携带优惠码（以及 `type=promo` 等参数），没有 `country` 或 `currency` 参数。国家和货币会在后续 `payments/checkout` 的 `billing_details` 中提交，并可能影响税费、最终价格以及 Checkout 对折扣的重新计算；因此“预检可用”不等于已经得到某个国家/货币下的最终应付金额。

## Checkout 返回与取消语义

Checkout 页面返回按钮只导航到创建请求中的 `cancel_url`，不会调用未付款订单取消接口。当前代码不把离开页面记录成“取消订单”，也没有虚构 `/backend-api/payments/checkout/cancel`。

已有订阅的停止自动续费是另一项操作，继续使用 `POST /backend-api/subscriptions/cancel`，它不退款，权益保留到当前周期结束。不要把这个接口用于未付款 Checkout。

## 集成边界

GAM 的 Business Checkout 生成器支持显式 `checkoutUiMode: 'custom'` 和 `seatQuantities`。默认仍使用 Stripe Hosted 路径，避免现有自动支付流程误把 ChatGPT Custom Checkout 当成 Stripe 表单；Custom 模式只负责生成并校准 ChatGPT Checkout URL，后续支付自动化需要单独实现 Custom Checkout 页面协议。
