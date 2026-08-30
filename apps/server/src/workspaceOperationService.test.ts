import assert from 'node:assert/strict';
import test from 'node:test';
import {
  memberRemovalSummary,
  normalizeWorkspaceExternalId,
  promotionRequiresRenewalAcknowledgement,
  workspaceSettingPayload,
  workspacePromotionApplyResult,
  workspacePromotionPreview
} from './services/workspaceOperationService.js';
import { promotionLookupView } from './domain/promotion.js';

test('Workspace 加入申请只接受 UUID 并统一为小写',()=>{
  assert.equal(normalizeWorkspaceExternalId(' 0A9B56EC-C0A2-473F-A8EA-8F25EF8CC5FC '),'0a9b56ec-c0a2-473f-a8ea-8f25ef8cc5fc');
  assert.throws(()=>normalizeWorkspaceExternalId('not-a-workspace-id'),/Workspace ID 必须是有效的 UUID/);
});

test('Workspace 单项设置成功后只合并提交值并保留已有快照细节',()=>{
  const original={default_seat_type:'usage_based',beta_settings:{personal_access_tokens:false,other:true},automatic_reload:{is_enabled:false,recharge_threshold:'10'}};
  const beta=workspaceSettingPayload(original,{key:'personalAccessTokensEnabled',value:true});
  assert.deepEqual(beta,{...original,personal_access_tokens:true,beta_settings:{personal_access_tokens:true,other:true}});
  const reload=workspaceSettingPayload(beta,{key:'automaticReloadEnabled',value:true});
  assert.deepEqual(reload,{...beta,automatic_reload_enabled:true,automatic_reload:{is_enabled:true,recharge_threshold:'10'}});
  assert.deepEqual(workspaceSettingPayload(reload,{key:'defaultSeat',value:'default'}),{...reload,default_seat_type:'default'});
});

test('member removal exposes only the structured billing and policy summary',()=>{
  const summary=memberRemovalSummary('remote-1',{email:'member@example.com',seat_type:'default'}, {success:true,billing_notice:{private:'kept in activity evidence'},policy_notice:{kind:'pending_replacement',billed_seat_delta:1,vacancy_ordinal:6,free_vacancy_threshold:5,replacement_required:true,unknown_field:'not exposed'}});
  assert.deepEqual(summary,{remoteUserId:'remote-1',email:'member@example.com',seatType:'default',upstreamSuccess:true,hasBillingNotice:true,policy:{kind:'pending_replacement',billedSeatDelta:1,vacancyOrdinal:6,freeVacancyThreshold:5,replacementRequired:true}});
  assert.equal('billingNotice' in summary,false);
  assert.equal('unknown_field' in (summary.policy??{}),false);
});

test('Workspace 优惠码预览保留上游拒绝原因',()=>{
  const preview=workspacePromotionPreview('INVALID',{is_eligible:false,ineligible_reason:{title:'促销优惠不可用',message:'优惠码无效。',code:'invalid_code'}},undefined,{});
  assert.deepEqual(preview,{promoCode:'INVALID',isEligible:false,ineligibleReason:{title:'促销优惠不可用',message:'优惠码无效。',code:'invalid_code'},subscription:{},wouldEnableRenewal:false});
});

test('Workspace 优惠码预览展示优惠期限并标记恢复续费风险',()=>{
  const preview=workspacePromotionPreview('PROMO',{is_eligible:true,ineligible_reason:null},{is_eligible:true,ineligible_reason:null,metadata:{plan_name:'chatgptteamplan',summary:'最高可享 1 个 Business 席位 48 个月优惠。',discount:{quantity_off:1},duration:{num_periods:48,period:'month'},no_auto_renewal_at_discount_end:false,promotion_type:'discount',processor:'stripe'}},{plan_type:'team',seats_in_use:2,seats_entitled:2,active_until:'2026-08-16T04:14:00Z',billing_period:'monthly',billing_currency:'GBP',will_renew:false,cancellation_outcome:'deactivate'});
  assert.equal(preview.isEligible,true);assert.equal(preview.wouldEnableRenewal,true);
  assert.deepEqual(preview.metadata,{planName:'chatgptteamplan',summary:'最高可享 1 个 Business 席位 48 个月优惠。',quantityOff:1,durationPeriods:48,durationPeriod:'month',noAutoRenewalAtDiscountEnd:false,promotionType:'discount',processor:'stripe'});
});

test('Workspace 优惠码回读识别续费已恢复',()=>{
  const result=workspacePromotionApplyResult('PROMO',{plan_type:'team',will_renew:false,cancellation_outcome:'deactivate'},{plan_type:'team',will_renew:true,cancellation_outcome:null});
  assert.equal(result.verified,true);assert.equal(result.renewalEnabled,true);
  assert.deepEqual(result.before,{planType:'team',willRenew:false,cancellationOutcome:'deactivate'});
  assert.deepEqual(result.after,{planType:'team',willRenew:true});
});

test('Workspace 优惠码对关闭或未知的续费状态都要求显式确认',()=>{
  assert.equal(promotionRequiresRenewalAcknowledgement({will_renew:false}),true);
  assert.equal(promotionRequiresRenewalAcknowledgement({}),true);
  assert.equal(promotionRequiresRenewalAcknowledgement({will_renew:true}),false);
});

test('优惠码查询结果保留个人空间和 Workspace 的独立上下文',()=>{
  const personal=promotionLookupView({kind:'personal'},'个人空间','PROMO',{is_eligible:true,ineligible_reason:null},{is_eligible:true,ineligible_reason:null,metadata:{plan_name:'chatgptteamplan'}},{plan_type:'free',will_renew:false});
  const workspace=promotionLookupView({kind:'workspace',workspaceId:'workspace-1'},'Business A','PROMO',{is_eligible:false,ineligible_reason:{code:'not_eligible'}},undefined,undefined);
  assert.equal(personal.target.kind,'personal');
  assert.equal(personal.subscription?.planType,'free');
  assert.equal(personal.wouldEnableRenewal,true);
  assert.deepEqual(workspace.target,{kind:'workspace',workspaceId:'workspace-1'});
  assert.equal(workspace.isEligible,false);
  assert.equal(workspace.ineligibleReason?.code,'not_eligible');
});
