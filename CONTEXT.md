# Team Manager Domain

本上下文统一 team-manager 中 Team workspace、远端关系、客户席位和到期提醒的业务术语。

## Language

**母号**:
拥有或管理一个 Team workspace 的 GPT 账号。母号记录的续费日期属于 Team workspace 套餐，不表示 GPT 账号自身到期。
_Avoid_: Team 成员、客户席位

**受管账号引用**:
可选的规范化邮箱，表示当前母号或子号在 GPT Account Manager 中存在对应受管账号。引用不改变 Team Manager 对 Web Session 和 Team 业务关系的独立所有权。
_Avoid_: CloakBrowser Profile ID、Account Manager 数据库 UUID、注册任务 ID

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
