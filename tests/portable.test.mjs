import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {localTool} from '../core.mjs';
test('portable tools use relocatable Python scripts; normal venv stays unchanged',()=>{
 assert.equal(localTool('D:/bundle/runtime/mineru-cli.py','mineru-api'),path.join('D:/bundle/runtime','mineru-api.py'));
 assert.equal(localTool('D:/venv/Scripts/mineru.exe','mineru-api'),path.join('D:/venv/Scripts','mineru-api'+(process.platform==='win32'?'.exe':'')));
});
test('portable marker isolates data, defaults and runtime from host installs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-portable-test-'));
 try{
  const app=path.join(root,'app/resources/app');fs.mkdirSync(app,{recursive:true});
  fs.writeFileSync(path.join(root,'mineru-desk-bundle.json'),'{}');
  for(const f of ['core.mjs','portable.cjs'])fs.copyFileSync(new URL('../'+f,import.meta.url),path.join(app,f));
  const env={...process.env};delete env.MINERU_DESK_DATA;
  const script="const m=await import('./core.mjs');console.log(JSON.stringify({root:m.bundleRoot,data:m.dataRoot,defaults:m.defaults,exe:m.findExecutable(m.defaults,'local')}))";
  const value=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:app,env,encoding:'utf8'}));
  assert.equal(value.root,root);assert.equal(value.data,path.join(root,'data'));assert.equal(value.defaults.modelRoot,path.join(root,'models'));assert.equal(value.defaults.outputRoot,path.join(root,'output'));assert.equal(value.defaults.offline,true);assert.equal(value.exe,null,'must not borrow host MinerU when bundled runtime is missing');
  fs.writeFileSync(path.join(root,'mineru-desk-bundle.json'),JSON.stringify({distribution:'installer'}));
  const installed=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:app,env,encoding:'utf8'}));
  const workspace=path.join(path.dirname(root),'MinerU-Desk-Data');assert.equal(installed.data,path.join(workspace,'data'));assert.equal(installed.defaults.modelRoot,path.join(workspace,'models'));assert.ok(!installed.defaults.modelRoot.startsWith(root+path.sep),'uninstall cannot own default model directory');
 }finally{assert.ok(path.basename(root).startsWith('mineru-portable-test-'));fs.rmSync(root,{recursive:true});}
});
