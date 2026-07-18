# 状态与排错

## 子号状态

| 状态 | 含义 | 处理 |
|---|---|---|
| 未录入 | 缺少可用 Web Session | 自动注册或录入 Session JSON |
| Session 可用 | Web Session 已保存 | 同步 Team 关联并创建 PAT |
| PAT 创建中 | 正在为目标 workspace 创建 PAT | 等待请求完成 |
| Codex 可用 | 至少有一份 PAT | 按目标 Team 刷新额度 |
| 待验证 | 注册服务等待人工验证 | 完成人机验证后重试原任务 |
| 账号锁定 | 上游账号被锁定或停用 | 停止重试并更换账号 |
| 异常 | 最近操作失败 | 在详情日志查看完整错误 |

Session Cookie 与 Web Access Token 分开检查。Session Cookie 有效但 Web Access Token 无效，表示登录 Cookie 仍可换取 Session，但当前 Bearer token 已被拒绝。

## 注册任务状态

注册任务显示在子号列表中，错误正文只在详情日志或注册服务日志中查看，列表保持稳定高度。

- `failed`、`interrupted`：点击“重试此邮箱”。
- `waiting_manual`：在注册服务保留的 profile 完成人机验证，再点击“人工验证后继续”。
- 注册服务不可用：检查 Team Manager 的注册服务地址与 Token，以及注册服务自身健康状态。

## PAT 问题

### workspace 不一致

系统拒绝保存绑定到其他 workspace 的 PAT。确认子号已加入目标 Team，并重新录入包含 `sessionToken` 的 ChatGPT Session。

### PAT 创建失败

检查目标 Team 的个人访问令牌权限、子号成员状态和子号代理。远端错误会完整写入子号日志。

### 额度 401

确认子号仍在对应 Team，然后重新创建该 workspace 的 PAT，再刷新额度。

## 页面与远端不一致

先使用页面刷新入口。不要直接编辑运行时 JSON；业务修改必须通过 UI、API 或 service/store 方法完成。
