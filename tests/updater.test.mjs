import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import updater from '../updater.cjs';
const {newer,releaseInfo,checksum,allowedDownload,createUpdater}=updater;
const base='https://github.com/chengyingzh433-stack/mineru-desk/releases/download/v0.3.2/';
const filename='MinerU-Desk-Setup-0.3.2-x64.exe';
const data=Buffer.from('synthetic installer; never executed');
const hash=crypto.createHash('sha256').update(data).digest('hex');
const release=()=>({tag_name:'v0.3.2',draft:false,prerelease:false,assets:[{name:filename,size:data.length,browser_download_url:base+filename},{name:'SHA256SUMS.txt',browser_download_url:base+'SHA256SUMS.txt'}]});
test('stable version comparison and release scope',()=>{
 assert.equal(newer('0.3.10','0.3.2'),true);assert.equal(newer('0.3.2','0.3.2'),false);assert.equal(newer('0.3.1','0.3.2'),false);
 assert.throws(()=>newer('v0.3.3-beta','0.3.2'));assert.equal(releaseInfo(release(),'0.3.1').available,true);
 const hostile=release();hostile.assets[0].browser_download_url='https://evil.example/install.exe';assert.throws(()=>releaseInfo(hostile,'0.3.1'));
 assert.equal(allowedDownload('https://github.com.evil.example/install'),false);assert.equal(allowedDownload(base+filename),true);
 assert.equal(allowedDownload('http://github.com/chengyingzh433-stack/mineru-desk/releases/download/x/y'),false);
 assert.throws(()=>checksum(hash+'  wrong.exe',filename));assert.throws(()=>checksum(`${hash}  ${filename}\n${hash}  ${filename}`,filename));
});
test('check never downloads; verified download and tampering rejection',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-updater-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let calls=0;
 const u=createUpdater({current:'0.3.1',directory:async()=>directory,fetchRelease:async()=>release(),downloadRequest:async url=>{calls++;return new Response(url.endsWith('SHA256SUMS.txt')?`${hash}  ${filename}`:data);}});
 assert.equal((await u.check()).status,'available');assert.equal(calls,0);assert.equal(fs.readdirSync(directory).length,0);
 assert.equal((await u.download()).status,'ready');assert.equal(calls,2);
 const saved=await u.verifiedInstaller();assert.equal(fs.readFileSync(saved.file).equals(data),true);
 fs.appendFileSync(saved.file,'modified');await assert.rejects(()=>u.verifiedInstaller(),/已变化/);
});
test('corrupt download is not installed and partial file is removed',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-updater-bad-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const u=createUpdater({current:'0.3.1',directory:async()=>directory,fetchRelease:async()=>release(),downloadRequest:async url=>new Response(url.endsWith('SHA256SUMS.txt')?`${'0'.repeat(64)}  ${filename}`:data)});
 await u.check();await assert.rejects(()=>u.download(),/校验失败/);assert.deepEqual(fs.readdirSync(directory),[]);await assert.rejects(()=>u.verifiedInstaller());
});
test('network failure is visible; current version offers no download',async()=>{
 const u=createUpdater({current:'0.3.2',directory:async()=>{throw Error('must not create cache');},fetchRelease:async()=>release()});
 assert.equal((await u.check()).status,'current');await assert.rejects(()=>u.download());
 const failed=createUpdater({current:'0.3.1',fetchRelease:async()=>{throw Error('offline');}});await assert.rejects(()=>failed.check(),/offline/);assert.equal(failed.snapshot().status,'error');
});
test('cancellation cleans updater-owned partial download',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-updater-cancel-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const u=createUpdater({current:'0.3.1',directory:async()=>directory,fetchRelease:async()=>release(),downloadRequest:async(url,{signal})=>{
  if(url.endsWith('SHA256SUMS.txt'))return new Response(`${hash}  ${filename}`);
  return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('aborted')),{once:true});setTimeout(()=>u.cancel(),10);}}));
 }});await u.check();await assert.rejects(()=>u.download(),/已取消/);assert.deepEqual(fs.readdirSync(directory),[]);
});
