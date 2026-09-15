import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {initializeBundledModels} from '../bundled-models.mjs';
test('bundled models initialize only new workspaces without copying or overriding user choices',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-model-init-'));
 try{
  const bundleRoot=path.join(root,'app'),workspaceRoot=path.join(root,'workspace'),dataRoot=path.join(workspaceRoot,'data');fs.mkdirSync(bundleRoot);
  fs.writeFileSync(path.join(bundleRoot,'mineru-desk-bundle.json'),JSON.stringify({distribution:'installer',modelsIncluded:true}));
  const model=path.join(workspaceRoot,'models','pipeline-bundled-0.3.1','models','Layout','PP-DocLayoutV2');fs.mkdirSync(model,{recursive:true});fs.writeFileSync(path.join(model,'model.safetensors'),'fixture');
  const args={bundleRoot,workspaceRoot,dataRoot};assert.equal(initializeBundledModels(args),true);
  const config=path.join(dataRoot,'mineru.json');assert.ok(JSON.parse(fs.readFileSync(config))['models-dir'].pipeline.startsWith(workspaceRoot));
  fs.writeFileSync(config,JSON.stringify({'models-dir':{}}));assert.equal(initializeBundledModels(args),false);assert.deepEqual(JSON.parse(fs.readFileSync(config)),{'models-dir':{}},'user deletion/import is retained');
 }finally{assert.ok(path.basename(root).startsWith('mineru-model-init-'));fs.rmSync(root,{recursive:true});}
});
