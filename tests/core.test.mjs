import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {defaults,optionDefaults,cacheKey,validateOptions,buildCommand,within} from '../core.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-desk-unit-'));
const file=path.join(dir,'中文 文件.pdf');fs.writeFileSync(file,'unit fixture');
test.after(()=>{assert.ok(within(dir,os.tmpdir()));assert.ok(path.basename(dir).startsWith('mineru-desk-unit-'));fs.rmSync(dir,{recursive:true});});
test('local paths and page indexes remain distinct argv elements',()=>{
 const o=validateOptions({...optionDefaults,pages:'2-8'},file,defaults);
 const command=buildCommand(file,path.join(dir,'output with spaces'),o,defaults,'mineru.exe');
 assert.equal(command.args[1],file);assert.equal(command.args[command.args.indexOf('-s')+1],'1');assert.equal(command.args[command.args.indexOf('-e')+1],'7');
 assert.ok(!command.args.includes('--api-url'));assert.ok(!command.args.includes('-u'));
});
test('API server address and inference address do not get confused',()=>{
 const settings={...defaults,serverUrl:'http://localhost:8000',vlmUrl:'http://localhost:30000'};
 const o=validateOptions({...optionDefaults,provider:'server',backend:'hybrid-http-client'},file,settings);
 const {args}=buildCommand(file,dir,o,settings,'mineru.exe');
 assert.equal(args[args.indexOf('--api-url')+1],settings.serverUrl);assert.equal(args[args.indexOf('-u')+1],settings.vlmUrl);
});
test('cloud token does not appear in argv or fingerprint settings',()=>{
 const o={...optionDefaults,provider:'cloud',cloudMode:'extract',formats:['md','docx'],pages:'1-5,10'};
 const {args}=buildCommand(file,dir,o,defaults,'cloud.exe');assert.ok(args.includes('md,docx'));assert.ok(!args.includes('--token'));assert.equal(args[args.indexOf('--pages')+1],'1-5,10');
});
test('cache depends on content, settings and runtime; force does not change key',()=>{
 const a=cacheKey('a',optionDefaults,defaults,'3.4.5');assert.equal(a,cacheKey('a',{...optionDefaults,force:true},defaults,'3.4.5'));
 for(const key of [cacheKey('b',optionDefaults,defaults,'3.4.5'),cacheKey('a',{...optionDefaults,formula:false},defaults,'3.4.5'),cacheKey('a',optionDefaults,defaults,'3.5.0')])assert.notEqual(a,key);
});
test('unsupported routes and ranges are rejected before jobs start',()=>{
 assert.throws(()=>validateOptions({provider:'local',backend:'vlm-http-client'},file,defaults));
 assert.throws(()=>validateOptions({pages:'0-2'},file,defaults));
 assert.throws(()=>validateOptions({pages:'4-2'},file,defaults));
 assert.throws(()=>validateOptions({pages:'1,4'},file,defaults));
 assert.throws(()=>validateOptions({extraArgs:['--api-url=https://example.com']},file,defaults));
 assert.throws(()=>validateOptions({provider:'local'},'https://example.com/paper.pdf',defaults));
});
test('canonical path containment rejects sibling and parent traversal',()=>{
 assert.equal(within(path.join(dir,'out','paper.md'),path.join(dir,'out')),true);
 assert.equal(within(path.join(dir,'outside'),path.join(dir,'out')),false);
 assert.equal(within(path.join(dir,'out','..','secret'),path.join(dir,'out')),false);
});
