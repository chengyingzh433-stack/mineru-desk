import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {bundleRoot,workspaceRoot,dataRoot,readJson,writeJson,runProcess,digestFile,within} from './core.mjs';
const appRoot=path.dirname(fileURLToPath(import.meta.url));
const version=readJson(path.join(appRoot,'package.json'),{}).version;
const [command='doctor',...args]=process.argv.slice(2);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let connection;
async function connect(){
 const c=readJson(path.join(dataRoot,'connection.json'),null);if(!c)return null;
 try{const r=await fetch(`http://127.0.0.1:${c.port}/api/identity`,{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error('Service identity mismatch');const identity=await r.json();if(identity.appRoot!==appRoot||identity.dataRoot!==dataRoot||identity.version!==version)throw Error('Service identity mismatch');return c;}
 catch(e){if(e.message==='Service identity mismatch')throw Error('此数据目录已有其他版本的服务。请先停止旧服务，不要覆盖 connection.json。');return null;}
}
async function start(){
 connection=await connect();if(connection)return;
 fs.mkdirSync(dataRoot,{recursive:true});
 // Atomic startup lock shared by agent callers; stale locks are reported, not blindly removed.
 const lock=path.join(dataRoot,'agent-start.lock');let fd;
 try{fd=fs.openSync(lock,'wx');}catch{for(let i=0;i<100;i++){await pause(200);connection=await connect();if(connection)return;}throw Error('启动锁未释放。请确认没有启动进程后检查 data/agent-start.lock。');}
 try{connection=await connect();if(connection)return;
  if(bundleRoot&&process.platform==='win32'){
   // PowerShell tracks descendants in a Windows job. DETACHED_PROCESS alone is
   // insufficient; break the persistent service out so CLI pipelines can finish.
   const launch=['import subprocess,sys,os','env=dict(os.environ,ELECTRON_RUN_AS_NODE="1",MINERU_DESK_DATA=sys.argv[3])','log=open(os.path.join(sys.argv[3],"service.log"),"ab")','p=subprocess.Popen([sys.argv[1],sys.argv[2]],env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,close_fds=True,creationflags=0x01000000|0x00000008|0x00000200)','print(p.pid)'].join('\n');
   await runProcess(path.join(bundleRoot,'runtime','python.exe'),['-c',launch,process.execPath,path.join(appRoot,'server.mjs'),dataRoot],{timeout:15});
  }else{
   const log=fs.openSync(path.join(dataRoot,'service.log'),'a');const child=spawn(process.execPath,[path.join(appRoot,'server.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',MINERU_DESK_DATA:dataRoot},windowsHide:true,detached:true,stdio:['ignore',log,log]});child.on('error',()=>{});child.unref();fs.closeSync(log);
  }
  for(let i=0;i<100;i++){await pause(200);connection=await connect();if(connection)return;}throw Error('服务启动失败，请检查 data/service.log。');}
 finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
async function api(route,body,method=body===undefined?'GET':'POST'){
 if(!/^[\w/-]+$/.test(route))throw Error('接口路径只能使用字母、数字、横线和斜杠。');
 const r=await fetch(`http://127.0.0.1:${connection.port}/api/${route}`,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const value=await r.json();if(!r.ok)throw Error(value.error||'HTTP '+r.status);return value;
}
async function doctor(){
 const [identity,environment,hardware,models]=await Promise.all([api('identity'),api('environment'),api('hardware'),api('models')]);
 const checks={runtime:environment.local.available?'passed':'failed',office:'not-tested',pdf:'not-tested',models:models.models.some(m=>m.id==='pipeline'&&m.installed)?'path-present-unverified':'missing',gpu:hardware.torch?.cudaAvailable?'available':'cpu-only'};
 const report={checkedAt:new Date().toISOString(),identity,checks,environment,hardware,models,next:checks.models==='missing'?'PDF 需要先下载或导入 Pipeline 模型，再执行 self-test --pdf；Office 可先执行 self-test。':'执行 self-test；如需 PDF，再执行 self-test --pdf。'};
 writeJson(path.join(dataRoot,'doctor-report.json'),report);return report;
}
async function finished(id){for(let i=0;i<300;i++){const t=await api('tasks/'+id);if(!['running','queued'].includes(t.status))return t;await pause(1000);}await api('tasks/'+id+'/cancel');throw Error('自检任务超时，已请求停止。');}
async function selfTest(){
 if(!bundleRoot)throw Error('自检样本随分享包提供，请在分享包中运行。');
 const state=await api('state');if(state.paused||state.tasks.some(t=>['running','queued'].includes(t.status))||state.modelsJob?.status==='running')throw Error('请等待已有任务结束并取消队列暂停后再自检。');
 const isPdf=args.includes('--pdf');const report={checkedAt:new Date().toISOString(),kind:isPdf?'pdf':'office',status:'failed'};
 const reportPath=path.join(dataRoot,isPdf?'pdf-self-test.json':'self-test.json');
 try{
  if(isPdf){const m=await api('models');if(!m.models.some(x=>x.id==='pipeline'&&x.installed)){report.status='needs-models';report.note='未配置 Pipeline 模型，未运行 PDF 解析；未自动下载模型。';return report;}}
  const source=path.join(bundleRoot,'examples',isPdf?'selftest.pdf':'selftest.docx');const before=await digestFile(source);
  const settingsSnapshot=state.settings;
  // No settings mutation; each self-test is forced to offline/local, preventing surprise downloads.
  if(!settingsSnapshot.offline)throw Error('自检要求设置中开启“离线使用已有模型”，以免触发模型下载。');
  const body={files:[source],outputRoot:path.join(workspaceRoot,'output','self-test'),origin:'codex',options:{provider:'local',backend:'pipeline',method:'auto',timeout:240,force:true}};
  const [first]=await api('tasks',body);const t=await finished(first.id);report.task=t.id;
  if(t.status!=='completed')throw Error(t.error||t.log||t.status);
  const content=await api('tasks/'+t.id+'/content');
  if(!content.original.includes('Physics Education'))throw Error('缺少样本文本');
  const references=[...content.original.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m=>m[1]);if(!references.length)throw Error('缺少 Markdown 图片引用');
  for(const ref of references){const image=path.resolve(path.dirname(t.markdown),decodeURIComponent(ref));if(!within(image,t.outputDir)||!fs.existsSync(image)||fs.statSync(image).size===0)throw Error('图片引用不完整：'+ref);}
  const [second]=await api('tasks',{...body,options:{...body.options,force:false}});const reused=await finished(second.id);if(reused.status!=='reused')throw Error('第二次未复用缓存');
  if(before!==await digestFile(source))throw Error('样本原文件发生变化');
  report.status='passed';report.cache='reused';report.imageReferences=references.length;report.originalPreserved=true;report.markdown=t.markdown;report.scope=isPdf?'仅验证本机两页合成 PDF；不代表任意论文的识别质量。':'DOCX 文本、表格和图片转换；不代表 PDF 模型已可用。';return report;
 }catch(e){report.error=e.message;return report;}finally{writeJson(reportPath,report);}
}
try{
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('此分享包仅支持 Windows x64；其他平台请使用官方对应环境。');
 if(command==='verify'){
  if(!bundleRoot)throw Error('请在分享包中运行校验。');
  const manifest=readJson(path.join(bundleRoot,'file-manifest.json'),null);if(!manifest?.files)throw Error('缺少发布文件清单。');
  const bad=[];for(const item of manifest.files){const p=path.resolve(bundleRoot,item.path);if(!within(p,bundleRoot)||!fs.existsSync(p)||await digestFile(p)!==item.sha256)bad.push(item.path);}
  let modelFiles=0;
  if(args.includes('--models')){
   const models=readJson(path.join(bundleRoot,'model-manifest.json'),null);if(!models?.files)throw Error('此包没有模型清单');
   const modelRoot=path.resolve(workspaceRoot,models.directory);if(!within(modelRoot,workspaceRoot))throw Error('模型清单路径越界');
   for(const item of models.files){const p=path.resolve(modelRoot,item.path);if(!within(p,modelRoot)||!fs.existsSync(p)||await digestFile(p)!==item.sha256)bad.push('model:'+item.path);}modelFiles=models.files.length;
  }
  console.log(JSON.stringify({checked:manifest.files.length,modelFiles,status:bad.length?'failed':'passed',mismatched:bad},null,2));process.exit(bad.length?2:0);
 }
 await start();let result;
 if(command==='doctor')result=await doctor();
 else if(command==='self-test')result=await selfTest();
 else if(command==='status')result=await api('state');
 else if(command==='stop')result=await api('shutdown',{});
 else if(command==='submit')result=await api('tasks',{...readJson(path.resolve(args[0]),null),origin:'codex'});
 else if(command==='request'){const method=args[0]?.toUpperCase();if(!['GET','POST'].includes(method))throw Error('用法：request GET|POST 接口 [JSON文件]');result=await api(args[1],method==='POST'?(args[2]?readJson(path.resolve(args[2]),{}):{}):undefined,method);}
 else throw Error('命令：verify | doctor | self-test [--pdf] | status | submit 请求.json | request GET|POST 接口 [请求.json] | stop');
 console.log(JSON.stringify(result,null,2));if(result.status==='failed'||result.status==='needs-models'||result.checks?.runtime==='failed')process.exitCode=2;
}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
