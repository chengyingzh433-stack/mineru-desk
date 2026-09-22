import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createStorage,validateDirectory} from './storage.mjs';
import {parseProgress} from './progress.mjs';
import {detectHardware} from './hardware.mjs';
import {createTaskMaintenance} from './task-maintenance.mjs';
import {initializeBundledModels} from './bundled-models.mjs';
import {installed,workspaceRoot} from './core.mjs';
import {bundleRoot,localTool,dataRoot,defaults,optionDefaults,supported,readJson,writeJson,within,digestFile,cacheKey,scanFiles,allFiles,findExecutable,runProcess,killProcess,validateOptions,buildCommand,assertUrl} from './core.mjs';

const appRoot=path.dirname(fileURLToPath(import.meta.url));
const token=crypto.randomBytes(32).toString('hex');
fs.mkdirSync(dataRoot,{recursive:true});
initializeBundledModels({bundleRoot,workspaceRoot,dataRoot});
const statePath=path.join(dataRoot,'state.json');
const state=readJson(statePath,{settings:{...defaults},tasks:[],paused:false});
state.settings={...defaults,...state.settings};
// Rebase only known path fields when a stopped portable folder has moved.
if(bundleRoot&&state.bundleRoot&&state.bundleRoot!==bundleRoot){
 const old=state.bundleRoot;const rebase=p=>typeof p==='string'&&path.isAbsolute(p)&&within(p,old)?path.join(bundleRoot,path.relative(old,p)):p;
 for(const key of ['outputRoot','modelRoot','workRoot','mineru','cloudCli'])state.settings[key]=rebase(state.settings[key]);
 for(const t of state.tasks){for(const key of ['source','outputRoot','outputDir','markdown','edited'])t[key]=rebase(t[key]);if(t.runtimeSettings)for(const key of ['outputRoot','modelRoot','workRoot','mineru','cloudCli'])t.runtimeSettings[key]=rebase(t.runtimeSettings[key]);t.key=null;}
 const configPath=path.join(dataRoot,'mineru.json'),config=readJson(configPath,{});
 if(config['models-dir']){for(const id of Object.keys(config['models-dir']))config['models-dir'][id]=rebase(config['models-dir'][id]);writeJson(configPath,config);}
 const ownedPath=path.join(dataRoot,'owned-models.json');if(fs.existsSync(ownedPath))writeJson(ownedPath,readJson(ownedPath,[]).map(rebase));
 // Old cleanup plans refer to the old drive; never execute them after relocation.
 const ledger=path.join(dataRoot,'storage-ledger.json');if(fs.existsSync(ledger))fs.renameSync(ledger,ledger+'.before-move-'+Date.now());
}
if(bundleRoot){state.bundleRoot=bundleRoot;writeJson(statePath,state);}
for(const t of state.tasks) if(['running','queued'].includes(t.status))t.status='interrupted';
const active=new Map();const probes=new Map();
let loopBusy=false,shuttingDown=false;let modelsJob=state.lastModelsJob||null;let modelProcess=null;const services=new Map();
if(modelsJob?.status==='running')modelsJob.status='interrupted';
const save=()=>writeJson(statePath,state);
const busy=()=>!!(loopBusy||active.size||modelsJob?.status==='running'||[...services.values()].some(s=>s.status==='running'));
const storage=createStorage({dataRoot,state,save,busy,modelConfig,runtimePath:()=>{try{return findExecutable(state.settings,'local');}catch{return state.settings.mineru;}}});
const maintenance=createTaskMaintenance({state,save,busy,dataRoot,protectedRoots:()=>[appRoot,...Object.values(modelConfig()['models-dir']||{}),bundleRoot?path.join(bundleRoot,'runtime'):null]});
const log=(t,text)=>{t.log=((t.log||'')+text).slice(-60000);t.progress=parseProgress(t.log,t.progress);t.updatedAt=new Date().toISOString();};
const modelLog=text=>{modelsJob.log=(modelsJob.log+redact(text)).slice(-60000);modelsJob.progress=parseProgress(modelsJob.log,modelsJob.progress);state.lastModelsJob=modelsJob;};
function redact(text) { return String(text).replace(/\x1b\[[0-9;]*m/g,'').replace(/Bearer\s+[^\s]+/gi,'Bearer [hidden]').replace(/([?&](?:token|signature|access_key|key)=)[^&\s]+/gi,'$1[hidden]'); }
function task(id){const t=state.tasks.find(x=>x.id===id);if(!t)throw Error('找不到任务');return t;}
const settingsPublic=()=>({...state.settings,hasToken:fs.existsSync(path.join(dataRoot,'cloud-token.dat'))||!!process.env.MINERU_TOKEN});

async function protect(value,decode=false) {
  if(process.platform!=='win32')throw Error('此版本的密钥保存使用 Windows 凭据保护；其他系统可配置 MINERU_TOKEN 环境变量');
  const script=`Add-Type -AssemblyName System.Security\n$v=[Console]::In.ReadToEnd()\n${decode?"$b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Text.Encoding]::UTF8.GetString($r))":"$b=[Text.Encoding]::UTF8.GetBytes($v); $r=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))"}`;
  return new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',c=>out+=c);p.on('error',reject);p.on('close',c=>c?reject(Error('Windows 密钥加密操作失败')):resolve(out.trim()));p.stdin.end(value);});
}
async function cloudToken(){ const file=path.join(dataRoot,'cloud-token.dat');return fs.existsSync(file)?protect(fs.readFileSync(file,'utf8'),true):process.env.MINERU_TOKEN; }
async function probe(kind,settings=state.settings) {
  const exe=findExecutable(settings,kind);if(!exe)return {available:false,exe:'',version:'未安装'};
  const key=exe+fs.statSync(exe).mtimeMs;
  if(probes.has(key))return probes.get(key);
  try {const result=await runProcess(exe,[kind==='cloud'?'version':'--version'],{timeout:30});const p={available:true,exe,version:result.trim().split('\n')[0]};probes.set(key,p);return p;}catch(e){return {available:false,exe,version:'检查失败',error:e.message};}
}
async function environment(){const [local,cloud]=await Promise.all([probe('local'),probe('cloud')]);return {local,cloud,memoryGB:Math.round(os.totalmem()/1024**3),platform:process.platform};}
function modelConfig(){return readJson(path.join(dataRoot,'mineru.json'),{});}
function getModels(){const config=modelConfig();const owned=readJson(path.join(dataRoot,'owned-models.json'),[]);return ['pipeline','vlm'].map(id=>{const p=config['models-dir']?.[id]||'';const exists=!!p&&fs.existsSync(p);return {id,name:id==='pipeline'?'Pipeline · 文档识别模型组':'VLM · 视觉语言模型',description:id==='pipeline'?'版面、OCR、表格与公式；支持 CPU':'供 VLM / Hybrid 使用；对显存要求较高',path:p,installed:exists,size:exists?allFiles(p).reduce((n,f)=>n+fs.statSync(f).size,0):0,managed:exists&&owned.includes(p)&&within(p,state.settings.modelRoot)&&path.resolve(p)!==path.resolve(state.settings.modelRoot)};});}
async function addTasks(body){
  if(modelsJob?.status==='running')throw Error('请等待模型下载或环境安装完成后再提交转换');
  if(!Array.isArray(body.files)||!body.files.length||body.files.length>2000)throw Error('请选择 1–2000 个文件');
  const root=body.outputRoot||state.settings.outputRoot;if(!path.isAbsolute(root))throw Error('输出文件夹必须是绝对路径');
  if(installed&&within(root,bundleRoot))throw Error('转换结果不能放进程序安装目录，请选择独立的数据目录，避免升级或卸载时被移除');
  const tasks=body.files.map(file=>{const options=validateOptions(body.options||{},file,state.settings);return {id:crypto.randomUUID(),name:/^https?:/.test(file)?new URL(file).hostname:path.basename(file),source:file,origin:body.origin==='codex'?'codex':'desktop',outputRoot:root,options,runtimeSettings:{...state.settings},status:'queued',createdAt:new Date().toISOString(),log:'',revision:0};});
  state.tasks.unshift(...tasks);save();void pump();return tasks;
}
async function convert(t){
  let temp;
  try {
    t.status='running';t.startedAt=new Date().toISOString();log(t,'正在检查运行环境与缓存…\n');save();
    const settings={...defaults,...(t.runtimeSettings||state.settings)};
    const runtime=await probe(t.options.provider==='cloud'?'cloud':'local',settings);if(!runtime.available)throw Error('转换程序不可用，请前往“模型与服务”检查或设置可执行文件');
    if(t.status==='canceled')return;
    const isUrl=/^https?:/.test(t.source);const digest=isUrl?null:await digestFile(t.source);
    if(t.status==='canceled')return;
    t.key=digest?cacheKey(digest,t.options,settings,runtime.version):null;
    const cached=!t.options.force&&t.key&&state.tasks.find(x=>x.id!==t.id&&x.key===t.key&&['completed','reused'].includes(x.status)&&x.outputRoot===t.outputRoot&&x.markdown&&fs.existsSync(x.markdown)&&(baseTask(x).artifacts||[]).every(f=>fs.existsSync(path.join(x.outputDir,f))));
    if(cached){const original=baseTask(cached);t.outputDir=original.outputDir;t.markdown=original.markdown;t.edited=original.edited;t.status='reused';t.reusedFrom=original.id;t.finishedAt=new Date().toISOString();log(t,'CACHE_REUSED：复用相同文件与参数的结果。\n');save();return;}
    const stem=t.name.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70)||'document';
    t.outputDir=path.join(t.outputRoot,stem+'_'+t.id.slice(0,8));fs.mkdirSync(t.outputDir,{recursive:true});
    const command=buildCommand(t.source,t.outputDir,t.options,settings,runtime.exe);
    const resources=storage.prepare(settings,'convert',t.id);temp=resources.temp;command.env={...command.env,...resources.env};
    t.progress={stage:'启动解析',percent:null,detail:'等待后端报告阶段进度'};
    if(t.options.provider==='cloud'){const credential=await cloudToken();if(credential)command.env.MINERU_TOKEN=credential;}
    log(t,`${runtime.version}\n输出：${t.outputDir}\n转换过程中会持续显示后端日志；首次使用可能需要下载模型。\n`);save();
    await runProcess(command.exe,command.args,{env:command.env,cwd:t.outputDir,timeout:Number(t.options.timeout),onLog:text=>log(t,redact(text)),onSpawn:p=>active.set(t.id,p)});
    if(t.status==='canceled')return;
    const files=allFiles(t.outputDir);const candidates=files.filter(p=>p.endsWith('.md'));
    t.artifacts=files.map(f=>path.relative(t.outputDir,f));
    t.markdown=candidates.sort((a,b)=>fs.statSync(b).size-fs.statSync(a).size)[0]||null;
    if(!files.length)throw Error('后端没有生成输出文件，请查看日志');
    t.status='completed';t.finishedAt=new Date().toISOString();log(t,'\n转换完成。\n');
  }catch(e){if(t.status!=='canceled'){t.status='failed';t.error=redact(e.message);log(t,'\n'+t.error+'\n');}}finally{active.delete(t.id);if(temp)storage.finish(temp,t.status==='completed');save();}
}
async function pump(){if(loopBusy||state.paused)return;loopBusy=true;try{while(!state.paused){const next=[...state.tasks].reverse().find(t=>t.status==='queued');if(!next)break;await convert(next);}}finally{loopBusy=false;}}
function outputFile(t,relative){if(!t.outputDir)throw Error('还没有输出结果');const p=path.resolve(t.outputDir,relative||'.');if(!within(p,t.outputDir))throw Error('无效的文件路径');if(fs.existsSync(p)&&!within(fs.realpathSync(p),fs.realpathSync(t.outputDir)))throw Error('不允许访问结果目录以外的链接');return p;}
function baseTask(t){const seen=new Set();while(t.reusedFrom){if(seen.has(t.id))throw Error('缓存记录关联错误');seen.add(t.id);t=task(t.reusedFrom);}return t;}
function content(t){const base=baseTask(t);const edited=base.markdown?base.markdown+'.edited.md':null;const file=edited&&fs.existsSync(edited)?edited:base.markdown;return {text:file&&fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',original:base.markdown&&fs.existsSync(base.markdown)?fs.readFileSync(base.markdown,'utf8'):'',revision:base.revision||0,edited:!!(edited&&fs.existsSync(edited)),markdown:base.markdown,files:t.outputDir?allFiles(t.outputDir).map(f=>({name:path.relative(t.outputDir,f).replaceAll('\\','/'),size:fs.statSync(f).size})):[]};}

async function api(req,res,url){
  const parts=url.pathname.split('/').filter(Boolean);const method=req.method;
  let body={};if(method==='POST'){let raw='';for await(const c of req){raw+=c;if(raw.length>15*1024*1024)throw Error('请求过大');}body=JSON.parse(raw||'{}');}
  const route=parts.slice(1).join('/');
  if(method==='GET'&&route==='identity')return {name:'mineru-desk',version:readJson(path.join(appRoot,'package.json'),{}).version,appRoot,dataRoot,bundleRoot,workspaceRoot,installed,pid:process.pid};
  if(method==='POST'&&shuttingDown)throw Error('程序正在退出，暂不接受新操作');
  if(method==='POST'&&route==='shutdown'){if(busy()||state.tasks.some(t=>t.status==='queued'))throw Error('还有任务或服务未停止，请先处理后再关闭。');shuttingDown=true;save();setTimeout(()=>{server.close(()=>process.exit(0));server.closeIdleConnections();},100);return {ok:true};}
  if(method==='GET'&&route==='state')return {...state,settings:settingsPublic(),modelsJob,dataRoot,workspaceRoot,installed};
  if(method==='POST'&&route==='history/archive')return maintenance.archive(body);
  if(method==='POST'&&route==='history/preview')return maintenance.preview(body);
  if(method==='POST'&&route==='history/purge')return maintenance.purge(body);
  if(method==='GET'&&route==='environment')return environment();
  if(method==='GET'&&route==='hardware')return detectHardware(state.settings,storage.diskInfo);
  if(method==='GET'&&route==='storage')return storage.overview();
  if(method==='POST'&&route==='storage/scan')return storage.scan();
  if(method==='POST'&&route==='storage/clean')return storage.clean(body);
  if(method==='GET'&&route==='services')return [...services.entries()].map(([name,s])=>({name,status:s.status,port:s.port,log:s.log}));
  if(method==='POST'&&route==='services/start'){
    if(modelsJob?.status==='running')throw Error('请等待模型下载或安装完成');
    if(!['api','gradio','openai-server','router'].includes(body.name))throw Error('无效的服务工具');if(services.get(body.name)?.status==='running')throw Error('该服务已在运行');
    const runtime=findExecutable(state.settings,'local');if(!runtime)throw Error('请先安装本地 MinerU');const exe=localTool(runtime,'mineru-'+body.name);if(!fs.existsSync(exe))throw Error('当前 MinerU 未安装这个服务入口');
    const port=Number(body.port);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('端口须为 1024–65535');
    const extra=body.extraArgs||[];if(!Array.isArray(extra)||extra.some(v=>typeof v!=='string'))throw Error('附加参数必须是 JSON 字符串数组');
    const args=body.name==='gradio'?['--server-name','127.0.0.1','--server-port',String(port)]:body.name==='openai-server'?['--port',String(port)]:['--host','127.0.0.1','--port',String(port)];
    const resources=storage.prepare(state.settings,'service');
    args.push(...extra);const entry={status:'running',port,log:'正在启动服务…\n',process:null};services.set(body.name,entry);
    void runProcess(exe,args,{cwd:resources.temp,env:{...resources.env,MINERU_TOOLS_CONFIG_JSON:path.join(dataRoot,'mineru.json'),MINERU_MODEL_SOURCE:state.settings.offline?'local':state.settings.modelSource},onSpawn:p=>entry.process=p,onLog:s=>entry.log=(entry.log+redact(s)).slice(-60000)}).then(()=>{entry.status='stopped';storage.finish(resources.temp,true);}).catch(e=>{entry.status='stopped';entry.log+='\n'+e.message;});return {status:entry.status,port};
  }
  if(method==='POST'&&route==='services/stop'){const entry=services.get(body.name);if(entry)killProcess(entry.process);return {ok:true};}
  if(method==='POST'&&route==='settings'){
    if(busy()&&['modelRoot','workRoot','mineru','modelSource'].some(k=>body[k]!==undefined&&body[k]!==state.settings[k]))throw Error('请先停止正在运行的转换、下载和服务，再修改存储路径或环境');
    const next={...state.settings};
    if(installed)for(const key of ['outputRoot','modelRoot','workRoot'])if(body[key]!==undefined&&within(body[key],bundleRoot))throw Error('数据目录不能放进程序安装目录，请选择独立文件夹');
    for(const key of ['outputRoot','modelRoot','workRoot'])if(body[key]!==undefined)next[key]=validateDirectory(body[key]);
    if(body.minFreeGB!==undefined){const n=Number(body.minFreeGB);if(!Number.isFinite(n)||n<0.25||n>100)throw Error('磁盘余量阈值须为 0.25–100 GB');next.minFreeGB=n;}
    const allowed=Object.keys(defaults);for(const [key,value] of Object.entries(body)){if(!allowed.includes(key)||['outputRoot','modelRoot','workRoot','minFreeGB'].includes(key))continue;if(['offline','autoCleanTemp'].includes(key))next[key]=!!value;else if(key==='maxJobs')next[key]=1;else if(typeof value==='string')next[key]=value;}
    state.settings=next;
    if(!['modelscope','huggingface'].includes(state.settings.modelSource))state.settings.modelSource='modelscope';
    save();probes.clear();return settingsPublic();
  }
  if(method==='POST'&&route==='token'){if(body.clear){fs.rmSync(path.join(dataRoot,'cloud-token.dat'),{force:true});return {ok:true};}if(typeof body.token!=='string'||!body.token.trim())throw Error('请输入 Token');fs.writeFileSync(path.join(dataRoot,'cloud-token.dat'),await protect(body.token.trim()));return {ok:true};}
  if(method==='POST'&&route==='scan')return scanFiles(body.directory);
  if(method==='POST'&&route==='tasks')return addTasks(body);
  if(method==='POST'&&route==='queue'){state.paused=!!body.paused;if(body.resumeInterrupted)for(const t of state.tasks)if(t.status==='interrupted')t.status='queued';save();void pump();return {paused:state.paused};}
  if(parts[1]==='tasks'&&parts[2]){
    const t=task(parts[2]);const action=parts[3];
    if(method==='GET'&&!action)return t;
    if(method==='GET'&&action==='content')return content(t);
    if(method==='POST'&&action==='cancel'){if(!['running','queued','interrupted'].includes(t.status))throw Error('该任务已结束');t.status='canceled';killProcess(active.get(t.id));save();return t;}
    if(method==='POST'&&action==='retry')return addTasks({files:[t.source],options:{...t.options,force:!!body.force},outputRoot:t.outputRoot,origin:t.origin});
    if(method==='POST'&&action==='edit'){
      const base=baseTask(t);if(!base.markdown)throw Error('没有可编辑的 Markdown');if(body.revision!==(base.revision||0)){res.statusCode=409;throw Error('该文档已在其他窗口修改，请重新载入后编辑');}
      const file=base.markdown+'.edited.md';if(fs.existsSync(file))fs.copyFileSync(file,file+'.previous');
      fs.writeFileSync(file,body.restore?fs.readFileSync(base.markdown,'utf8'):String(body.text),'utf8');base.edited=file;base.revision=(base.revision||0)+1;save();return content(t);
    }
    if(method==='GET'&&(action==='file'||action==='source')){
      const file=action==='source'?t.source:outputFile(t,url.searchParams.get('path'));
      if(/^https?:/.test(file))throw Error('URL 输入没有本地原文文件');
      res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");streamFile(res,file);return undefined;
    }
    if(method==='POST'&&action==='open')return {path:body.source?t.source:t.outputDir};
  }
  if(method==='GET'&&route==='models')return {models:getModels(),job:modelsJob};
  if(method==='POST'&&route==='models/download'){
    if(busy())throw Error('请先停止当前转换、下载和服务');if(!['pipeline','vlm','all'].includes(body.model))throw Error('无效的模型');
    const runtime=findExecutable(state.settings,'local');if(!runtime)throw Error('请先安装或配置本地 MinerU');
    const exe=localTool(runtime,'mineru-models-download');if(!fs.existsSync(exe))throw Error('找不到模型下载程序');
    const settings={...state.settings},resources=storage.prepare(settings,'download');
    if(storage.diskInfo(settings.modelRoot).free<settings.minFreeGB*1024**3)throw Error('模型目录所在磁盘余量不足，请更换目录或先清理');
    modelsJob={status:'running',model:body.model,root:settings.modelRoot,log:'模型目录：'+settings.modelRoot+'\n临时目录：'+resources.temp+'\n正在连接模型库…\n',progress:{stage:'连接模型库',percent:null,detail:'等待下载器报告进度'}};
    const env={...resources.env,MINERU_MODEL_SOURCE:settings.modelSource,MINERU_TOOLS_CONFIG_JSON:path.join(dataRoot,'mineru.json')};
    void runProcess(exe,['-s',settings.modelSource,'-m',body.model],{env,cwd:resources.temp,onLog:modelLog,onSpawn:p=>modelProcess=p}).then(()=>{modelsJob.status='completed';const owned=readJson(path.join(dataRoot,'owned-models.json'),[]);const config=modelConfig();for(const id of (body.model==='all'?['pipeline','vlm']:[body.model])){const p=config['models-dir']?.[id];if(p&&within(p,settings.modelRoot))owned.push(p);}writeJson(path.join(dataRoot,'owned-models.json'),[...new Set(owned)]);storage.finish(resources.temp,true);}).catch(e=>{modelsJob.status=modelsJob.cancelRequested?'canceled':'failed';modelLog('\n'+e.message);}).finally(()=>{modelProcess=null;state.lastModelsJob=modelsJob;save();});
    return modelsJob;
  }
  if(method==='POST'&&route==='models/cancel'){if(modelsJob)modelsJob.cancelRequested=true;killProcess(modelProcess);return {ok:true};}
  if(method==='POST'&&route==='models/delete'){
    if(busy())throw Error('请等待转换、模型下载及服务停止后再删除');
    const m=getModels().find(x=>x.id===body.model);if(!m?.installed||!m.managed||body.confirmPath!==m.path)throw Error('只能删除由应用管理、并已确认路径的模型');
    const real=fs.realpathSync(m.path);const root=fs.realpathSync(state.settings.modelRoot);if(real===root||!within(real,root))throw Error('模型路径不在管理目录中');
    if(getModels().some(x=>x.id!==m.id&&x.installed&&(within(x.path,real)||within(real,x.path))))throw Error('该目录与其他模型共用，无法单独删除');
    const config=modelConfig();delete config['models-dir'][m.id];
    // Only the exact configured model subtree is removed, never the model cache root.
    fs.rmSync(real,{recursive:true});writeJson(path.join(dataRoot,'mineru.json'),config);return {ok:true};
  }
  if(method==='POST'&&route==='models/import'){
    if(busy())throw Error('请先停止转换、模型下载及服务');
    if(!['pipeline','vlm'].includes(body.model)||!path.isAbsolute(body.path)||!fs.statSync(body.path).isDirectory())throw Error('请选择已有模型文件夹');const config=modelConfig();config['models-dir']={...config['models-dir'],[body.model]:body.path};writeJson(path.join(dataRoot,'mineru.json'),config);return {ok:true};
  }
  if(method==='POST'&&route==='server/test'){const address=assertUrl(state.settings.serverUrl);const response=await fetch(address+'/health',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('服务返回 '+response.status);return response.json();}
  if(method==='POST'&&route==='install'){
    if(bundleRoot)throw Error('便携包使用固定的 CPU 环境。请下载新版完整包；需要 GPU 时另建环境，并在设置中选择该程序，勿直接升级随包环境。');
    if(busy())throw Error('请等待当前任务和服务停止');const runtime=findExecutable(state.settings,'local');
    if(!['update','local'].includes(body.kind))throw Error('不支持此安装操作');
    if(body.kind==='update'&&!runtime)throw Error('请先安装或配置本地 MinerU');
    const resources=storage.prepare(state.settings,'install'),runtimeDir=path.join(state.settings.workRoot,'runtime');
    modelsJob={status:'running',model:'runtime',log:'新环境目录：'+runtimeDir+'\n正在准备本地 MinerU 环境…\n'};
    const onLog=modelLog;const onSpawn=p=>modelProcess=p;
    void (async()=>{let py;if(body.kind==='local'){await runProcess('py',['-3.12','-m','venv',runtimeDir],{env:resources.env,onLog,onSpawn});py=path.join(runtimeDir,'Scripts/python.exe');}else py=path.join(path.dirname(runtime),process.platform==='win32'?'python.exe':'python');await runProcess(py,['-m','pip','install','--upgrade','mineru[all]'],{env:resources.env,onLog,onSpawn});if(body.kind==='local')state.settings.mineru=path.join(path.dirname(py),'mineru.exe');save();modelsJob.status='completed';probes.clear();storage.finish(resources.temp,true);})().catch(e=>{modelsJob.status=modelsJob.cancelRequested?'canceled':'failed';modelLog('\n'+e.message+'\n若未安装 Python 3.12，请先通过安装说明获取 Python。');}).finally(()=>{modelProcess=null;state.lastModelsJob=modelsJob;save();});return modelsJob;
  }
  throw Error('未知接口：'+route);
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.md':'text/plain; charset=utf-8'};
function streamFile(res,file){if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}res.setHeader('Content-Type',mime[path.extname(file).toLowerCase()]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Length',fs.statSync(file).size);fs.createReadStream(file).pipe(res);}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/api/')){
      const provided=req.headers.authorization?.replace(/^Bearer /,'')||url.searchParams.get('token');if(provided!==token){res.writeHead(401);res.end('Unauthorized');return;}
      const result=await api(req,res,url);if(result===undefined)return;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(result));return;
    }
    let file;
    if(url.pathname.startsWith('/vendor/')){file=path.join(appRoot,'node_modules',decodeURIComponent(url.pathname.slice(8)));if(!within(file,path.join(appRoot,'node_modules')))throw Error('无效的路径');}
    else {file=path.join(appRoot,'web',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));if(!within(file,path.join(appRoot,'web')))throw Error('无效的路径');}
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'self'; base-uri 'none'");streamFile(res,file);
  }catch(e){if(!res.headersSent){res.statusCode=res.statusCode===409?409:400;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:e.message}));}else res.end();}
});
server.listen(Number(process.env.MINERU_DESK_PORT||0),'127.0.0.1',()=>{const port=server.address().port;writeJson(path.join(dataRoot,'connection.json'),{port,token,pid:process.pid});console.log('MINERU_DESK_READY '+port);});
setInterval(()=>{if(active.size||modelsJob?.status==='running'){state.lastModelsJob=modelsJob;save();}},2000).unref();
process.on('SIGTERM',()=>{for(const child of active.values())killProcess(child);killProcess(modelProcess);for(const s of services.values())killProcess(s.process);state.lastModelsJob=modelsJob;save();server.close(()=>process.exit());});
