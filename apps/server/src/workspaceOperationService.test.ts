import assert from 'node:assert/strict';
import test from 'node:test';
import { memberRemovalSummary } from './services/workspaceOperationService.js';

test('member removal exposes only the structured billing and policy summary',()=>{
  const summary=memberRemovalSummary('remote-1',{email:'member@example.com',seat_type:'default'}, {success:true,billing_notice:{private:'kept in activity evidence'},policy_notice:{kind:'pending_replacement',billed_seat_delta:1,vacancy_ordinal:6,free_vacancy_threshold:5,replacement_required:true,unknown_field:'not exposed'}});
  assert.deepEqual(summary,{remoteUserId:'remote-1',email:'member@example.com',seatType:'default',upstreamSuccess:true,hasBillingNotice:true,policy:{kind:'pending_replacement',billedSeatDelta:1,vacancyOrdinal:6,freeVacancyThreshold:5,replacementRequired:true}});
  assert.equal('billingNotice' in summary,false);
  assert.equal('unknown_field' in (summary.policy??{}),false);
});
