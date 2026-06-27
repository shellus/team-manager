# AGENTS.md

## General Rules

- 以中文回复。
- 新会话先阅读 `README.md` 和本文件，并明确说明已理解的主要内容。
- 任务涉及母号、子号、Team workspace、席位类型、Codex 凭证、额度或 Team 关联时，必须先阅读 [`docs/core/seat-and-credential-model.md`](docs/core/seat-and-credential-model.md)。
- 如果 `.codex/AGENTS.md` 存在，也要阅读它获取当前机器运行状态、tmux/docker/nginx 入口等本地信息。`.codex/AGENTS.md` 属于本机私有文件，应通过 `.git/info/exclude` 忽略，不要提交。
- 用户的网名/命名空间是 `shellus`，允许在开源项目、版权人、包命名空间等场景使用。

## Git Rules

- 新会话先检查 git 状态；如果项目不是 git 仓库，询问用户是否初始化。
- 在用户确认代码测试通过后再提交，不要自行认定任务完成后直接提交。
- 如果用户要求多个不相关变更，先询问是否提交已完成部分，避免多个功能耦合进一个提交。
- 环境相关的域名、IP、端口、账号、密钥、token、代理、部署路径等不得写入 git 管理文件；这些信息放在 `.env`、部署目录或 `.codex/AGENTS.md`。
- 提交前总是检查 `git status` 和 `git diff`，移除临时测试代码、debug 输出和无关改动。
- 提交消息必须具体，使用 `feat:`、`fix:` 等前缀时描述实际行为；不要使用“优化体验”“改进架构”这类空泛措辞。
- 提交消息不要署名，不要添加 Claude、Codex 或其他工具署名。

## Coding Rules

- 当前任务是为项目整体服务的，不只处理用户指出的单点；实现前先查看同类代码，遵循已有风格，复用已有 helper 和数据模型。
- DRY 是硬约束。新增字段、缓存或派生数据前，先检查是否会造成重复、冗余或断链。
- 当前项目通常运行在 tmux 热重载 dev 模式下。源码、前端 Vite 配置、后端 tsx watch 能自动加载的变更，默认只做验证，不手动重启 tmux 会话或 dev 进程。只有进程级环境变量、端口/监听方式、依赖安装、进程崩溃卡死，或离线迁移运行时数据需要停写入方时，才允许重启对应进程。
- 运行时 JSON 数据文件只能作为排查证据。管理动作必须通过 API、UI 或现有 service/store 方法完成；不要通过手工编辑 `data/*.json` 来让业务变更生效。
- 只有在用户明确要求离线修复数据文件时，才允许直接编辑运行时 JSON；操作前必须停对应实例、备份文件，并在完成后重启/刷新验证。
- 发现与当前任务无关但需要修复或重构的问题时，提醒用户，并记录到合适的项目文档或后续事项中。

## Validation

- 常用验证命令：

```bash
corepack pnpm --filter @team-manager/shared build
corepack pnpm --filter @team-manager/server test
corepack pnpm typecheck
corepack pnpm build
```

- 文档或配置变更至少检查链接、敏感信息和 git 状态。
