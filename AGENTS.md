# AGENTS.md

## General Rules

- 新会话先阅读 `README.md` 和本文件，并明确说明已理解的主要内容。
- 任务涉及账号、Workspace、席位类型、Codex 凭证、额度或成员关系时，必须先阅读 [`docs/core/seat-and-credential-model.md`](docs/core/seat-and-credential-model.md)。
- 任务涉及用新账号填充 CPA/Codex 凭证号池、批量加入多个 Workspace、PAT 凭证生成或清理无用 Codex 席位成员时，必须先阅读 [`docs/guide/fill-credential-pool.md`](docs/guide/fill-credential-pool.md)。
- 如果 `README.local.md` 存在，也要阅读它获取本机私有运行说明。`README.local.md` 应由本机 git ignore 规则忽略，不要提交。

## Git Rules

- 新会话先检查 git 状态；如果项目不是 git 仓库，询问用户是否初始化。
- 在用户确认代码测试通过后再提交，不要自行认定任务完成后直接提交。
- 如果用户要求多个不相关变更，先询问是否提交已完成部分，避免多个功能耦合进一个提交。
- 环境相关的域名、IP、端口、账号、密钥、token、代理、部署路径等不得写入源码 Git；这些信息放在私有部署目录的 `config.yaml` 或 `README.local.md`。
- 提交前总是检查 `git status` 和 `git diff`，移除临时测试代码、debug 输出和无关改动。
- 提交消息必须具体，使用 `feat:`、`fix:` 等前缀时描述实际行为；不要使用“优化体验”“改进架构”这类空泛措辞。
- 提交消息不要署名，不要添加 Claude、Codex 或其他工具署名。

## Coding Rules

- 当前任务是为项目整体服务的，不只处理用户指出的单点；实现前先查看同类代码，遵循已有风格，复用已有 helper 和数据模型。
- DRY 是硬约束。新增字段、缓存或派生数据前，先检查是否会造成重复、冗余或断链。
- Team Manager 是业务 Web Session 的唯一持久化事实源；保存新 Session 时删除旧 Session，不得在业务请求中从 GAM 自动回读。GAM 只在注册成功时一次性交付 Session，Team Manager 保存成功后确认清除。注册密码、CloakBrowser profile 与支付状态属于 GPT Account Manager，不得复制到业务模型。完整上游原始追踪属于文件制品，数据库只保存索引。
- Team Manager 可通过 Account Manager gateway 转发受管账号的 Profile 启动、状态和关闭请求，但不得直接调用 CloakBrowser、保存运行 Profile ID 或提供 VNC/浏览器查看能力。
- 后端所有外部 HTTP 请求必须通过 `apps/server/src/transport.ts` 的 `Transport` 或 `fetchWithRawTrace` 发出，并写入完整、未脱敏、未截断的私有上游追踪。不得在其他生产代码中直接调用 `fetch`，也不得引入 `axios`、`node:http/https`、`undici`、`child_process curl` 等旁路；新增上游必须使用可识别的 `upstream` 名称。进程级 `catch-all-fetch` 只作为遗漏兜底，不能替代具名接入。
- 应用只从显式指定的 YAML 配置读取运行设置；不得重新引入 `.env` 或在业务模块直接读取 `process.env`。Compose、worker、Vite 的临时环境由部署目录的统一配置启动器派生。
- 已由运行环境提供 watch/dev 进程时，源码、前端 Vite 配置、后端 tsx watch 能自动加载的变更默认只做验证，不手动重启运行进程。只有进程级环境变量、端口/监听方式、依赖安装、进程崩溃卡死，或离线迁移运行时数据需要停写入方时，才允许重启对应进程。
- 运行时 JSON 数据文件只能作为排查证据。管理动作必须通过 API、UI 或现有 service/store 方法完成；不要通过手工编辑 `data/*.json` 来让业务变更生效。
- 只有在用户明确要求离线修复数据文件时，才允许直接编辑运行时 JSON；操作前必须停对应实例、备份文件，并在完成后重启/刷新验证。
- 发现与当前任务无关但需要修复或重构的问题时，提醒用户，并记录到合适的项目文档或后续事项中。

## Validation

- 按变更范围运行对应测试、类型检查或构建；具体脚本入口以 `package.json` 和 `README.md` 为准，不在本文件重复维护框架常用命令。
- 文档或配置变更至少检查链接、敏感信息和 git 状态。
