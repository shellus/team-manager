# Team Manager Domain

本上下文统一 Team Manager 中账号、个人空间、Workspace、成员关系、客户席位、凭证和套餐操作的业务术语。

## Language

**账号（Account）**:
Team Manager 中唯一的受管 ChatGPT 登录身份，以规范化邮箱识别。账号可以没有 Workspace、管理多个 Workspace，或在多个 Workspace 中拥有不同成员关系。
_Avoid_: 母号、子号、Team 账号类型

**账号分组（Account Group）**:
账号唯一归属的本地运营分组。分组拥有稳定身份并可重命名，名称不是账号上的自由字符串。
_Avoid_: 账号标签、凭证号池分组、Workspace 分类

**个人空间（Personal Space）**:
与账号一对一的 ChatGPT 个人上下文，承载 Free、Go、Plus、Pro 5x、Pro 20x、个人支付方式、个人账单和个人设置。
_Avoid_: Workspace、Membership、Team 套餐

**Workspace**:
独立的 Team/Business 空间，以远端 Workspace account ID 识别，承载成员、邀请、设置、订阅、账单和客户席位。Workspace 不永久属于某个账号。
_Avoid_: 母号、账号、个人空间

**成员关系（Workspace Membership）**:
账号或远端身份在一个 Workspace 中已经接受的关系，包含角色、席位类型和状态。账号是否拥有可管理空间由活动 owner/admin 成员关系派生。
_Avoid_: 客户席位、待处理邀请、账号类型

**同步账号与 Workspace 关系**:
根据受管账号当前可访问的 Workspace 集合校准其成员关系；远端不再存在的成员关系进入已移除状态，Workspace 本身不受影响。
_Avoid_: 刷新 Workspace 列表、删除 Workspace、退出 Workspace

**彻底删除本地 Workspace**:
显式、不可逆地删除 Team Manager 保存的 Workspace 及其从属业务资料，不代表也不会触发远端 Workspace 删除。账号关系同步不会自动执行此操作。
_Avoid_: 远端删除 Workspace、账号退出 Workspace、自动清理

**彻底删除账号**:
不可逆删除账号及其专属资料和已结束操作历史，但不删除独立的 Workspace。活动 Workspace 关系、凭证、订单或未结束操作仍存在时，账号不满足彻底删除条件。
_Avoid_: 退出 Workspace、删除 Workspace、归档账号

**待处理邀请（Workspace Invitation）**:
已经发出但尚未转为成员关系的 Workspace 邀请。邀请与成员关系是不同生命周期，不使用空成员关系表达邀请。
_Avoid_: 待邀请、成员关系

**拥有可管理空间**:
账号在至少一个活动 Workspace 中拥有活动 owner/admin 成员关系的派生能力。它是筛选和授权条件，不是账号字段或账号类型。
_Avoid_: 母号、`isParent`、Workspace 所有者字段

**受管账号引用**:
账号在 GPT Account Manager 中使用的规范化邮箱引用。它允许 Team Manager 发起 Profile、代理、注册和支付操作，但不转移浏览器身份、密码或支付现场的所有权。
_Avoid_: CloakBrowser Profile ID、GAM 数据库 UUID

**账号会话修订（Account Session Revision）**:
账号完整 ChatGPT Web Session 的不可变历史版本。当前修订可以为个人空间和不同 Workspace 换取相互隔离的 Access Context。
_Avoid_: Workspace Token、覆盖式 Session 字段

**访问上下文（Account Access Context）**:
账号在个人空间或指定 Workspace 下换取的 Web Access Token。相同账号的不同上下文互不覆盖，成员关系变化不会推断其有效性，状态以真实请求结果为准。
_Avoid_: 全局账号 Token、跨 Workspace Token

**客户席位（Seat Slot）**:
Workspace 下已运营或售出的本地席位资源。当前邮箱只是占用身份，换号、邀请转成员或席位类型变化不会改变客户资料、价格、到期日和历史。
_Avoid_: 成员关系、邮箱资料、ChatGPT 固定容量

**席位概览**:
独立一级页面，以客户席位为唯一卡片粒度的跨 Workspace 运营视图，按客户席位到期日排序。成员关系、待处理邀请和固定 ChatGPT 空位只用于同步或容量判断，不会自动成为租客席位卡片。
_Avoid_: 成员概览、邀请概览、固定席位空位

**母号概览**:
独立一级运营页面，只展示双席位 Business Workspace，并按精确续费/到期时间排序。页面从 owner 优先的可管理关系中确定一个管理账号；该账号缺失或已标记封号时不展示卡片。“母号”只作为界面中的运营称呼，卡片标题使用直接状态、账号备注和管理账号，不显示 Workspace 名称，也不产生母号实体。
_Avoid_: 个人套餐、Business 0.52、封号管理账号、母号数据表、Workspace 所有者字段

**公开换号**:
客户使用稳定 `seatKey` 更换客户席位当前邮箱的自助流程。它不得自动移除已接受的标准 ChatGPT 成员。
_Avoid_: 管理员移除成员、标准席位自动轮转

**固定 ChatGPT 席位容量**:
Business 订阅提供的固定 ChatGPT 位置。`usage_based` 成员不占固定位置，当前成员数也不等于计费席位事实。
_Avoid_: Workspace 成员数、Codex 凭证数、客户席位数

**临时计费席位**:
标准 ChatGPT 成员移除后上游可能继续计费的位置。最终状态必须以 Billing 为准，不能从成员或客户席位数量推导。
_Avoid_: 当前成员、空位、已释放席位

**Workspace 凭证（Workspace Credential）**:
绑定“账号 × Workspace”的 Codex OAuth 或 PAT 凭证。规范 JSON 正文是受控文件制品，数据库只保存关联、索引、哈希、状态和额度快照。
_Avoid_: 账号全局凭证、可改字段跨 Workspace 的凭证

**凭证号池分组（Credential Pool Group）**:
用于 CPA/Codex 凭证投放的分组，与账号分组完全独立。
_Avoid_: 账号分组、Workspace 分组

**个人套餐变更**:
账号个人空间首次开通或变更 Go、Plus、Pro 5x、Pro 20x 的统一操作。目标套餐、当前套餐和生效方式必须由上游确认。
_Avoid_: Pro 5x 专用开通、Business 开通

**账号运营主套餐（Account Operational Primary Plan）**:
根据账号个人空间和活动 Workspace 成员关系给出的单一运营称呼。它用于账号列表展示和筛选，不改变个人套餐、Workspace 套餐或成员关系事实。
_Avoid_: 账号套餐、缓存套餐、账号类型

**Team 子号**:
账号运营主套餐的一种称呼，表示账号存在活动 Workspace 成员关系，但所有活动关系都不是 owner。admin 也属于此称呼；它不表示账号类型或从属关系。
_Avoid_: 子账号类型、Workspace 所有者、普通成员角色

**Business 开通**:
为账号创建新的 Business Workspace，或把账号可管理的既有 Workspace 升级为 Business 的操作。
_Avoid_: 增加成员、个人套餐变更、Workspace 设置

**订阅目标（Subscription Target）**:
一次订阅或支付操作明确作用的个人空间或 Workspace。个人空间和 Workspace 的订阅生命周期彼此独立，不能从执行账号推断目标。
_Avoid_: 当前账号套餐、默认 Workspace、隐式支付账号

**订阅支付方式绑定**:
账号把一次性卡片输入交给 GPT Account Manager，为明确的订阅目标创建并设定默认支付方式。Team Manager 不保存完整卡片。
_Avoid_: 个人支付方式绑定、Workspace 账单卡、保存完整卡片

**取消订阅续费**:
关闭明确订阅目标的自动续费，不退款也不立即移除当前周期权益。个人空间和 Workspace 使用相同语义，并以实时复读 `will_renew=false` 为成功依据。
_Avoid_: 个人套餐取消任务、退订退款、GAM 取消操作

**自动支付**:
Business Checkout 准备完成后是否自动提交付款的显式选项。默认关闭，与 Automatic reload 不同。
_Avoid_: 自动填卡、Team 自动续费、Automatic reload

**Automatic reload**:
Workspace Credits 余额低于阈值时使用默认支付方式补充 Credits 的设置。
_Avoid_: Business 续费、Checkout 自动支付

**Team 升级订单**:
以指定既有 Workspace 为目标生成的 Business Checkout。支付链接有效不代表已经付款或订阅已经生效。
_Avoid_: 新建 Workspace、有效 Business 订阅

**订单维护池**:
需要周期性维护 Team 升级订单的 Workspace 集合。维护关系保存执行账号，但不把 Workspace 永久归属于该账号。
_Avoid_: 账号状态、Workspace owner 字段

**封号标记**:
由用户人工维护、独立于远端状态和 Web Session 可用性的账号运营标记。
_Avoid_: 自动封号检测、删除账号

**Profile 控制**:
Team Manager 通过受管账号引用请求 GPT Account Manager 启动或关闭账号运行 Profile。Team Manager 不拥有浏览器 Profile，也不提供 VNC。
_Avoid_: Profile 所有权、直接调用 CloakBrowser
