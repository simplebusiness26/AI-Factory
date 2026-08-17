import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseFactory, buildToday, releaseState } from '../src/factory.mjs';

const projects=[
  {id:'alpha',name:'Alpha',brain:{currentState:'Building',nextActions:['Ship alpha'],blockers:[]},github:{build:{status:'completed',conclusion:'success',name:'CI',url:'https://example.com/build'},latestRelease:{name:'v1',url:'https://example.com/release',publishedAt:'2026-08-17',assets:[{name:'alpha.apk',url:'https://example.com/a.apk',size:123}]}}},
  {id:'beta',name:'Beta',brain:{currentState:'Blocked',nextActions:['Fix beta'],blockers:['Missing config']},github:{build:{status:'completed',conclusion:'failure',name:'Build',url:null}}}
];

test('releaseState finds latest APK',()=>{const item=releaseState(projects[0]);assert.equal(item.buildState,'success');assert.equal(item.apk.name,'alpha.apk');assert.equal(item.releaseName,'v1')});

test('buildReleaseFactory counts pass fail release and APK',()=>{const result=buildReleaseFactory(projects);assert.equal(result.passing,1);assert.equal(result.failing,1);assert.equal(result.withRelease,1);assert.equal(result.withApk,1)});

test('buildToday puts critical incidents before normal next actions',()=>{const watchtower={incidents:[{projectId:'beta',projectName:'Beta',code:'build_failed',severity:'critical',message:'Latest build failed.',detail:'Build'}]};const result=buildToday(projects,watchtower);assert.equal(result.tasks[0].projectId,'beta');assert.equal(result.tasks[0].priority,1);assert.ok(result.tasks.some(item=>item.projectId==='alpha'&&item.title==='Ship alpha'))});

test('buildToday caps the daily queue at ten',()=>{const many=Array.from({length:20},(_,i)=>({id:`p${i}`,name:`P${i}`,brain:{currentState:'',nextActions:[`Task ${i}`],blockers:[]},github:{}}));const result=buildToday(many,{incidents:[]});assert.equal(result.tasks.length,10)});
