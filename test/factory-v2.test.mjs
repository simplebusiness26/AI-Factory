import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_SEEDS, normalizeWorkOrder, buildExecutionPlan } from '../src/factory-v2.mjs';

test('engineering work routes to DevCouncil and verification without granting merge/deploy',()=>{
  const work=normalizeWorkOrder({
    id:'work_test_engineering',
    objective:'Implement the new ClipMine API feature and open a pull request',
    repository:'simplebusiness26/ClipMine',
    acceptanceCriteria:['tests pass']
  });
  const plan=buildExecutionPlan(work,CAPABILITY_SEEDS);
  assert.deepEqual(plan.route,['factory-planner','devcouncil','verification-core']);
  assert.equal(work.authority.mayMerge,false);
  assert.equal(work.authority.mayDeployProduction,false);
  assert.equal(plan.dispatchable,false);
  assert.match(plan.blockers.join(' '),/DevCouncil/);
});

test('design work targets DesignLab V3 before DevCouncil',()=>{
  const work=normalizeWorkOrder({objective:'Redesign the Xplorer profile UI and implement the winning layout'});
  const plan=buildExecutionPlan(work,CAPABILITY_SEEDS);
  assert.deepEqual(plan.route.slice(0,4),['factory-planner','designlab-v3','devcouncil','verification-core']);
  assert.match(plan.blockers.join(' '),/DesignLab V3/);
});

test('production deployment is blocked without explicit Operating System authority',()=>{
  const work=normalizeWorkOrder({objective:'Deploy the verified website to production'});
  const plan=buildExecutionPlan(work,CAPABILITY_SEEDS);
  assert.ok(plan.route.includes('deployment-gate'));
  assert.equal(plan.dispatchable,false);
  assert.match(plan.blockers.join(' '),/mayDeployProduction/);
});

test('planning-only work can enter the queue using ready internal capabilities',()=>{
  const work=normalizeWorkOrder({objective:'Analyse the captured evidence and produce an execution plan'});
  const plan=buildExecutionPlan(work,CAPABILITY_SEEDS);
  assert.deepEqual(plan.route,['factory-planner','verification-core']);
  assert.equal(plan.dispatchable,true);
});
