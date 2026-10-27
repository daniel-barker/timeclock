/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS runner loads transpiled modules without an extra test dependency. */
/* Tests the real store against Atlas using temporary, isolated user IDs.
   Run from the project root: node scripts/test-timeclock.cjs --integration */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const { MongoClient } = require('mongodb');
const modules = new Map();
function load(relative) {
  const file = path.resolve(relative);
  if (modules.has(file)) return modules.get(file);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  const localRequire = (name) => name === 'server-only' ? {} : name.startsWith('.')
    ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name);
  vm.runInNewContext(output, { exports, require: localRequire, console, Date, Buffer }, { filename: file });
  modules.set(file, exports);
  return exports;
}

async function main() {
  const { commandSchema, formatDuration } = load('src/lib/timeclock/validation.ts');
  assert.equal(formatDuration(3661000, true), '01:01:01');
  assert.equal(formatDuration(-1000, true), '00:00:00');
  assert.equal(formatDuration(25 * 3600000), '25h 00m');
  assert.equal(commandSchema.safeParse({action:'create-project', name:'   ', operationId:randomUUID()}).success, false);
  assert.equal(commandSchema.safeParse({action:'stop',entryId:'not-an-id'}).success, false);
  assert.equal(commandSchema.safeParse({action:'archive-project',projectId:'not-an-id'}).success, false);
  assert.equal(commandSchema.safeParse({action:'restore-project'}).success, false);
  const parsed = commandSchema.parse({action:'create-project',name:'  Sample   Project  ',operationId:randomUUID()});
  assert.equal(parsed.name,'Sample Project');
  console.log('Validation and duration checks passed.');
  const {entriesCsv} = load('src/lib/timeclock/csv.ts');
  const csvSample = entriesCsv([{id:'sample',project:'Quotes, "and"\nlines',archived:true,task:' =SUM(A1)',startedAt:new Date('2026-01-01T00:00:00.000Z'),endedAt:new Date('2026-01-01T01:00:00.500Z')}]);
  assert.ok(csvSample.startsWith('\uFEFF"Session ID"'));
  assert.ok(csvSample.includes('"Quotes, ""and""\nlines"'));
  assert.ok(csvSample.includes('"\' =SUM(A1)"'));
  assert.ok(csvSample.includes('"3600.5"'));
  assert.equal(entriesCsv([]).split('\r\n').length,2);
  const {toLocalInput, fromLocalInput} = load('src/lib/timeclock/local-time.ts');
  const originalTime = '2026-01-15T15:12:13.456Z';
  assert.equal(fromLocalInput(toLocalInput(originalTime),originalTime),originalTime);
  assert.throws(()=>fromLocalInput('invalid',originalTime));
  if (!process.argv.includes('--integration')) return;

  require('@next/env').loadEnvConfig(process.cwd(), true, {info(){},error(){}});
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  const db = client.db(process.env.MONGODB_DB);
  const owner = 'timeclock-test-' + randomUUID();
  const other = 'timeclock-test-' + randomUUID();
  const { createTimeclockStore } = load('src/lib/timeclock/store.ts');
  const store = createTimeclockStore(db, client);
  const secondDevice = createTimeclockStore(db, client);
  const create = (name) => store.execute(owner, {action:'create-project',name,operationId:randomUUID()});
  const start = (projectId, taskName, operationId=randomUUID()) => ({action:'start',projectId,taskName,operationId});
  try {
    const {projectId} = await create('Project One');
    const {projectId: otherProjectId} = await create('Project Two');
    await assert.rejects(create('project one'), (e) => e.status === 409);
    await assert.rejects(store.execute(other,start(projectId,'Not yours')), (e) => e.status === 404);
    assert.equal((await store.snapshot(other)).projects.length, 0);
    const request = start(projectId,'Research');
    const first = await store.execute(owner,request);
    await db.collection('timeclock_entries').updateOne({_id:first.entryId,userId:owner}, {$set:{startedAt:new Date(Date.now()-60000)}});
    assert.equal((await secondDevice.snapshot(owner)).active.id,first.entryId);
    assert.equal((await store.execute(owner,request)).entryId, first.entryId);
    assert.equal((await store.execute(owner,start(projectId,' research '))).entryId,first.entryId);
    const second = await store.execute(owner,start(otherProjectId,'Design'));
    let snapshot = await store.snapshot(owner);
    assert.equal(snapshot.active.id,second.entryId);
    const previous = snapshot.entries.find(e=>e.id===first.entryId);
    assert.equal(previous.endedAt,snapshot.active.startedAt);
    assert.ok(snapshot.projects.find(p=>p.id===projectId).completedMs >= 60000);
    // A replay and an old stop cannot affect a newer timer.
    await store.execute(owner,request);
    await store.execute(owner,{action:'stop',entryId:first.entryId});
    assert.equal((await store.snapshot(owner)).active.id,second.entryId);
    await assert.rejects(store.execute(other,{action:'stop',entryId:second.entryId}),e=>e.status===404);
    await store.execute(owner,{action:'stop',entryId:second.entryId});
    assert.equal((await store.snapshot(owner)).active,null);
    // Concurrent devices serialize through the per-user timer document.
    const results = await Promise.allSettled([
      store.execute(owner,start(projectId,'Concurrent A')),
      secondDevice.execute(owner,start(projectId,'Concurrent B')),
    ]);
    for (const result of results) assert.equal(result.status,'fulfilled');
    snapshot = await secondDevice.snapshot(owner);
    assert.ok(snapshot.active);
    assert.equal(await db.collection('timeclock_entries').countDocuments({userId:owner,endedAt:null}),1);
    const all = await db.collection('timeclock_entries').find({userId:owner}).sort({startedAt:1}).toArray();
    for(let i=1;i<all.length;i++) {
      assert.ok(all[i-1].endedAt);
      assert.ok(all[i-1].endedAt.getTime()<=all[i].startedAt.getTime());
    }
    await store.execute(owner,{action:'stop',entryId:snapshot.active.id});
    const final = await store.snapshot(owner);
    const raw = await db.collection('timeclock_entries').find({userId:owner}).toArray();
    const sum=raw.reduce((ms,e)=>ms+e.endedAt.getTime()-e.startedAt.getTime(),0);
    assert.equal(final.projects.reduce((ms,p)=>ms+p.completedMs,0),sum);
    assert.equal(final.tasks.reduce((ms,t)=>ms+t.completedMs,0),sum);
    assert.equal(final.tasks.filter(t=>t.name==='Research').length,1);
    const archive = {action:'archive-project',projectId};
    const restore = {action:'restore-project',projectId};
    await db.collection('timeclock_projects').updateOne({_id:projectId,userId:owner},{$unset:{archivedAt:''}});
    assert.equal((await store.snapshot(owner)).projects.find(project=>project.id===projectId).archivedAt,null);
    await assert.rejects(store.execute(other,archive),error=>error.status===404);
    await assert.rejects(store.execute(other,restore),error=>error.status===404);
    await assert.rejects(store.execute(owner,{action:'archive-project',projectId:randomUUID()}),error=>error.status===404);
    const running = await store.execute(owner,start(projectId,'Research'));
    await assert.rejects(store.execute(owner,archive),error=>error.status===409);
    assert.equal((await store.snapshot(owner)).active.id,running.entryId);
    await store.execute(owner,{action:'stop',entryId:running.entryId});
    const otherRunning = await store.execute(owner,start(otherProjectId,'Design'));
    const beforeArchive = await store.snapshot(owner);
    await store.execute(owner,archive);
    const afterArchive = await secondDevice.snapshot(owner);
    const archivedProject = afterArchive.projects.find(project=>project.id===projectId);
    assert.ok(archivedProject.archivedAt);
    assert.equal(archivedProject.completedMs,beforeArchive.projects.find(project=>project.id===projectId).completedMs);
    assert.equal(archivedProject.sessions,beforeArchive.projects.find(project=>project.id===projectId).sessions);
    assert.deepEqual(afterArchive.tasks,beforeArchive.tasks);
    assert.deepEqual(afterArchive.entries,beforeArchive.entries);
    assert.equal(afterArchive.active.id,otherRunning.entryId);
    await store.execute(owner,archive);
    assert.equal((await store.snapshot(owner)).projects.find(project=>project.id===projectId).archivedAt,archivedProject.archivedAt);
    await assert.rejects(store.execute(owner,start(projectId,'Blocked task')),error=>error.status===409);
    assert.equal((await store.snapshot(owner)).active.id,otherRunning.entryId);
    assert.equal(await db.collection('timeclock_tasks').countDocuments({userId:owner,name:'Blocked task'}),0);
    await assert.rejects(create('project one'),error=>error.status===409 && error.message.includes('restore'));
    await store.execute(owner,restore);
    await store.execute(owner,restore);
    const restored = await secondDevice.snapshot(owner);
    assert.equal(restored.projects.find(project=>project.id===projectId).archivedAt,null);
    assert.deepEqual(restored.tasks,beforeArchive.tasks);
    assert.deepEqual(restored.entries,beforeArchive.entries);
    const resumed = await store.execute(owner,start(projectId,'Research'));
    assert.equal((await store.snapshot(owner)).active.id,resumed.entryId);
    await store.execute(owner,{action:'stop',entryId:resumed.entryId});
    const {projectId: raceProjectId} = await create('Archive Race');
    const raceResults = await Promise.allSettled([
      store.execute(owner,{action:'archive-project',projectId:raceProjectId}),
      secondDevice.execute(owner,start(raceProjectId,'Race task')),
    ]);
    assert.equal(raceResults.filter(result=>result.status==='fulfilled').length,1);
    const rejected = raceResults.find(result=>result.status==='rejected');
    assert.equal(rejected.reason.status,409);
    const raced = await store.snapshot(owner);
    const raceProject = raced.projects.find(project=>project.id===raceProjectId);
    assert.ok(!(raceProject.archivedAt && raced.active?.projectId===raceProjectId));
    if (raced.active) await store.execute(owner,{action:'stop',entryId:raced.active.id});
    const edit = {action:'edit-entry',entryId:first.entryId,taskName:'Corrected task',startedAt:new Date(Date.now()-7200000).toISOString(),endedAt:new Date(Date.now()-3600000).toISOString(),expectedVersion:0,operationId:randomUUID()};
    await assert.rejects(store.execute(other,edit),e=>e.status===404);
    await assert.rejects(store.execute(owner,{...edit,endedAt:edit.startedAt}),e=>e.status===400);
    await assert.rejects(store.execute(owner,{...edit,endedAt:new Date(Date.now()+60000).toISOString()}),e=>e.status===400);
    await store.execute(owner,{action:'archive-project',projectId});
    await store.execute(owner,edit);
    await store.execute(owner,edit);
    const edited = await secondDevice.snapshot(owner);
    assert.equal(edited.entries.find(e=>e.id===first.entryId).version,1);
    assert.equal(edited.tasks.find(t=>t.name==='Corrected task').completedMs,Date.parse(edit.endedAt)-Date.parse(edit.startedAt));
    await assert.rejects(store.execute(owner,{...edit,operationId:randomUUID()}),e=>e.status===409);
    await assert.rejects(store.execute(owner,{...edit,entryId:second.entryId,operationId:randomUUID(),taskName:'Must not exist'}),e=>e.status===409);
    assert.equal(await db.collection('timeclock_tasks').countDocuments({userId:owner,name:'Must not exist'}),0);
    const concurrentEdits = await Promise.allSettled([
      store.execute(owner,{...edit,expectedVersion:1,operationId:randomUUID(),taskName:'Correction A'}),
      secondDevice.execute(owner,{...edit,expectedVersion:1,operationId:randomUUID(),taskName:'Correction B'}),
    ]);
    assert.equal(concurrentEdits.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(concurrentEdits.find(r=>r.status==='rejected').reason.status,409);
    const runningEdit = await store.execute(owner,start(otherProjectId,'Running edit test'));
    await assert.rejects(store.execute(owner,{...edit,entryId:runningEdit.entryId,operationId:randomUUID()}),e=>e.status===409);
    assert.equal((await store.snapshot(owner)).active.id,runningEdit.entryId);
    const exported = await store.exportCsv(owner);
    assert.ok(!exported.includes(runningEdit.entryId));
    assert.ok(exported.includes(first.entryId));
    assert.ok(exported.includes('"Archived"'));
    const scopedExport = await store.exportCsv(owner,projectId);
    assert.ok(scopedExport.includes(first.entryId));
    assert.ok(!scopedExport.includes(second.entryId));
    await assert.rejects(store.exportCsv(other,projectId),e=>e.status===404);
    assert.equal(await store.exportCsv(other),entriesCsv([]));
    const oldRows = Array.from({length:35},(_,i)=>({_id:randomUUID(),userId:owner,projectId,taskId:previous.taskId,startedAt:new Date(100000+i*2000),endedAt:new Date(101000+i*2000)}));
    await db.collection('timeclock_entries').insertMany(oldRows);
    const fullExport = await store.exportCsv(owner,projectId);
    for(const row of oldRows) assert.ok(fullExport.includes(row._id));
    console.log('Atlas checks passed: tracking, archiving, editing, and CSV exports (ownership, archived projects, full history, project filtering, and running-session exclusion).');
  } finally {
    // Only records created under these randomly generated test identities.
    for(const name of ['timeclock_projects','timeclock_tasks','timeclock_entries']) {
      await db.collection(name).deleteMany({userId:{$in:[owner,other]}});
    }
    await db.collection('timeclock_timers').deleteMany({_id:{$in:[owner,other]}});
    await client.close();
    console.log('Temporary test records removed.');
  }
}
main().catch(error=>{
  // Do not print database error messages that could contain connection details.
  console.error('Test failed:',error.name,'code:',error.code ?? 'n/a');
  if(error.name==='AssertionError') console.error('Assertion:',error.operator);
  process.exitCode=1;
});
