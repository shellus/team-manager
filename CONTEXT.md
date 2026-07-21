# Team Manager Domain

本上下文统一 team-manager 中 Team workspace、远端关系、客户席位和到期提醒的业务术语。

## Language

**母号**:
作为 Workspace 业务主体管理的 GPT 账号。母号可以尚未拥有可管理 Workspace；0.52 Codex 空间和双席位 Team 套餐都是该账号上的独立开通结果。
_Avoid_: Team workspace、Team 成员、客户席位

**可管理 Workspace**:
母号当前指向且可执行成员、邀请、设置和账单操作的 GPT workspace。0.52 usage-based Workspace 与双席位 Team Workspace 都属于可管理 Workspace；个人 `free` 账号不属于。
_Avoid_: 双席位 Team、Team 套餐状态

**同步 Workspace**:
母号主动重新确认当前可管理 Workspace 的校准动作。个人态母号可用它发现外部开通的 0.52 或 Team Workspace；未发现 Workspace 表示尚未开通空间，是正常空状态。
_Avoid_: 同步双席位、开通 Team、同步套餐

**固定 ChatGPT 席位容量**:
双席位 Team 套餐提供的两个 ChatGPT 固定位置，可由成员、邀请或空位占用。0.52 usage-based Workspace 没有固定 ChatGPT 席位容量，因此不产生空位。
_Avoid_: Workspace 成员数、Codex 席位、可管理 Workspace

**受管账号引用**:
可选的规范化邮箱，表示当前母号或子号在 GPT Account Manager 中存在对应受管账号。引用不改变 Team Manager 对 Web Session 和 Team 业务关系的独立所有权。
_Avoid_: CloakBrowser Profile ID、Account Manager 数据库 UUID、注册任务 ID

**0.52 开通**:
母号通过 GPT Account Manager 创建 13 Credits usage-based workspace 的独立支付动作。它不是母号注册完成或双席位开通的前置条件。
_Avoid_: 母号注册第二阶段、Team 套餐

**双席位开通**:
母号购买两个固定席位的 Team 月付套餐，并新建 Team workspace 或升级指定既有 Workspace 的独立支付动作。
_Avoid_: 0.52 开通、增加两个成员

**双席位订阅状态**:
Workspace 当前是否存在有效的 Team 月付订阅。该状态独立于 Workspace 种类和当前成员数量，以当前有效的月付关系为准。
_Avoid_: Workspace 类型、两个默认席位成员、0.52 状态

**双席位开通目标**:
一次双席位开通作用的 GPT workspace。未选择目标表示创建新 Team workspace；选择目标表示升级该 GAM 母号下的指定既有空间。
_Avoid_: 母号记录、任意 Team workspace

**自动支付**:
双席位开通在 Stripe 页面准备完成后是否自动点击 Pay 的显式选项。默认关闭；关闭时进入人工处理并继续监听付款结果。
_Avoid_: 自动填卡、自动创建订单

**Automatic reload**:
Workspace 的 Credits 余额低于远端阈值时，自动使用默认支付方式补充 Credits 的开关。它不表示 Team 套餐续费，也不等同于开通流程的自动支付。
_Avoid_: Team 自动续费、自动支付

**Team 续费**:
Team workspace 套餐在 `nextRenewalOn` 对应日期发生的续费事件。
_Avoid_: 母号到期、成员到期

**客户席位**:
母号下已运营或售出的 ChatGPT 固定席位位置，由 `seatSlots` 表示。邮箱只是当前位置的占用者，换号不会改变席位本身。
_Avoid_: 成员资料、邮箱资料、member profile

**成员**:
已经加入 Team workspace 的远端账号关系。成员本身没有 team-manager 本地到期日期。
_Avoid_: 客户席位

**待处理邀请**:
已经发出但尚未转为正式成员的远端邀请关系。面向用户的状态文案使用“邀请待接受”。
_Avoid_: 待邀请

**客户席位到期**:
客户席位的 `expiresOn` 进入提醒窗口。只有开启 `expireReminder` 的客户席位参与提醒。
_Avoid_: 成员到期、邮箱到期

**到期提醒**:
同时包含 Team 续费和客户席位到期的统一通知。任一分类非零时发送，消息始终展示两个分类及各自数量。
_Avoid_: Team 成员到期提醒
