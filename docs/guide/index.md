# 业务流程总览

team-manager 的业务流程围绕四个对象展开：母号、Team workspace、子号和 Codex 凭证。母号负责管理 Team；子号负责加入 Team 并使用该 Team 下的 Codex 凭证；席位类型决定账单风险和额度来源。

## 核心流程

1. 录入母号 session。
2. 刷新母号状态，确认 Team 名称、成员、待处理邀请和默认席位。
3. 将新成员默认席位设置为 Codex 席位，并按需调整“允许成员发送 Codex 邀请”等 Team 权限开关，降低普通成员误邀造成 ChatGPT 固定席位超额的风险。
4. 邀请成员或子号邮箱进入目标 Team，按业务需要选择 ChatGPT 席位或 Codex 席位。
5. 在子号页录入子号 session，或导入已有 CPA/Codex credential JSON。
6. 同步子号 Team 关联，确认该子号在目标 Team 中是 `member` 或 `invited`。
7. 对每个目标 Team 生成或导入对应 Codex 凭证。
8. 刷新额度，查看该凭证在对应 Team workspace 下的额度窗口。

需要用新号批量填充 CPA/Codex 号池时，按[新号填充凭证号池 SOP](./fill-credential-pool)执行。该流程要求先确认可用母号和席位边界，再让新子号加入目标 Team，并按“子号 × Team workspace”生成 PAT 凭证。

## 页面入口

| 页面 | 主要用途 | 常见动作 |
|---|---|---|
| 母号 | Team workspace 管理 | 录入母号、刷新、邀请成员、修改默认席位、设置 Codex 邀请权限、设置个人访问令牌权限、查看待处理邀请、改成员席位、移出成员 |
| 子号 | 子号池和 Codex 凭证管理 | 录入子号、导入已有凭证、编辑本地资料、同步 Team 关联、自动授权、生成登录 URL、刷新额度、导出凭证 |

## 业务边界

- 管理动作必须通过页面、API 或 service/store 方法完成，不通过编辑运行时 JSON 文件生效。
- 成员数、ChatGPT 席位数、pending invite 数和列表标签从当前缓存派生，不作为独立数据维护。
- Codex 凭证按“子号 × Team workspace”保存。同一子号加入多个 Team 时，需要保留多份凭证。
- GongXi-Mail、短信接码、Flaresolverr 和 curl_cffi worker 是运行环境能力。页面只读展示可用状态，不保存连接参数。

## 席位类型

| 席位 | 原始值 | 业务含义 |
|---|---|---|
| ChatGPT 席位 | `default` | 占用 Team 固定席位，有 Team 额度窗口，可能产生额外账单 |
| Codex 席位 | `usage_based` | 不占用固定 ChatGPT 席位，不提供 ChatGPT 席位额度 |

邀请成员或把成员切换到 ChatGPT 席位时，如果会超过已购固定席位数量，系统会提示账单风险。只有明确确认后，操作才会继续。

## 推荐日常顺序

1. 先在母号页刷新目标 Team。
2. 确认默认席位是 Codex 席位，并按需关闭成员发送 Codex 邀请。
3. 邀请或调整成员前，先查看 ChatGPT 席位已用数量。
4. 子号加入 Team 后，在子号页同步 Team 关联。
5. 按目标 Team 生成或导入 Codex 凭证。
6. 刷新额度并根据额度窗口决定是否轮转席位。
