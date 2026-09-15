import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {within,readJson,writeJson} from './core.mjs';

export function validateDirectory(value){
 if(typeof value!=='string'||!value.trim()||!path.isAbsolute(value))throw Error('请选择绝对路径的具体文件夹');
 const p=path.resolve(value);
 if([path.parse(p).root,os.homedir(),process.env.USERPROFILE,process.env.LOCALAPPDATA,process.env.APPDATA,process.env.TEMP].filter(Boolean).some(x=>path.resolve(x).toLowerCase()===p.toLowerCase()))throw Error('不能使用磁盘根目录、整个用户目录或系统临时目录');
 let current=p;
 while(true){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('存储目录不能经过符号链接或目录联接');const parent=path.dirname(current);if(parent===current)break;current=parent;}
 fs.mkdirSync(p,{recursive:true});
 const probe=path.join(p,'.mineru-write-test-'+crypto.randomUUID());
 fs.writeFileSync(probe,'');fs.unlinkSync(probe);return p;
}
export function storageEnvironment(settings,temp){
 const work=settings.workRoot;
 return {TEMP:temp,TMP:temp,TMPDIR:temp,PIP_CACHE_DIR:path.join(work,'pip-cache'),XDG_CACHE_HOME:path.join(work,'cache'),TORCH_HOME:path.join(work,'cache','torch'),HF_HOME:path.join(settings.modelRoot,'huggingface'),HF_HUB_CACHE:path.join(settings.modelRoot,'huggingface','hub'),HUGGINGFACE_HUB_CACHE:path.join(settings.modelRoot,'huggingface','hub'),HF_XET_CACHE:path.join(settings.modelRoot,'huggingface','xet'),MODELSCOPE_CACHE:path.join(settings.modelRoot,'modelscope')};
}
// Never follow links. Tree stamps detect changes between preview and deletion.
export function treeInfo(root){
 const hash=crypto.createHash('sha256');let bytes=0,files=0,links=false,count=0;
 function visit(p){if(++count>100000)throw Error('目录超过十万项，请缩小存储目录后重试');const stat=fs.lstatSync(p);if(stat.isSymbolicLink()){links=true;hash.update(p+'link');return;}
  hash.update(p+'|'+stat.size+'|'+stat.mtimeMs+'|'+stat.ino);
  if(stat.isDirectory())for(const name of fs.readdirSync(p).sort())visit(path.join(p,name));else {bytes+=stat.size;files++;}}
 if(!fs.existsSync(root))return {bytes:0,files:0,links:false,stamp:'missing'};visit(root);return {bytes,files,links,stamp:hash.digest('hex')};
}
function diskInfo(p){try{let parent=p;while(!fs.existsSync(parent)&&path.dirname(parent)!==parent)parent=path.dirname(parent);const s=fs.statfsSync(parent);return {free:s.bavail*s.bsize,total:s.blocks*s.bsize};}catch{return {free:null,total:null};}}
function overlaps(a,b){return within(a,b)||within(b,a);}
function noLinks(p){let current=path.resolve(p);for(;;){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())return false;const parent=path.dirname(current);if(parent===current)return true;current=parent;}}

export function createStorage({dataRoot,state,save,busy,modelConfig,runtimePath=()=>state.settings.mineru}){
 const ledgerPath=path.join(dataRoot,'storage-ledger.json');
 const ledger=readJson(ledgerPath,{scopes:[],history:[]});
 let plan=null;
 const persist=()=>writeJson(ledgerPath,ledger);
 function scope(kind,p,extra={}){p=path.resolve(p);if(!ledger.scopes.some(s=>s.kind===kind&&s.path===p)){ledger.scopes.push({kind,path:p,createdAt:new Date().toISOString(),...extra});persist();}return p;}
 // Old versions only managed these two dedicated cache subdirectories.
 const legacy=path.join(dataRoot,'models');
 for(const sub of ['huggingface','modelscope'])if(fs.existsSync(path.join(legacy,sub)))scope('model-cache',path.join(legacy,sub));
 function prepare(settings,kind,id=crypto.randomUUID()){
  validateDirectory(settings.workRoot);validateDirectory(settings.modelRoot);
  const free=diskInfo(settings.workRoot).free;
  if(free!==null&&free<Number(settings.minFreeGB||1)*1024**3)throw Error('临时缓存所在磁盘余量低于安全阈值，请更换目录或清理空间');
  const temp=path.join(settings.workRoot,'tmp',kind+'-'+id);fs.mkdirSync(temp,{recursive:true});scope('temp',temp,{owner:id});
  for(const p of [path.join(settings.modelRoot,'huggingface'),path.join(settings.modelRoot,'modelscope')])scope('model-cache',p);
  scope('pip-cache',path.join(settings.workRoot,'pip-cache'));scope('work',settings.workRoot);
  return {temp,env:storageEnvironment(settings,temp)};
 }
 function protectedPaths(){const models=Object.values(modelConfig()['models-dir']||{}).filter(x=>typeof x==='string'&&path.isAbsolute(x));const paths=[...state.tasks.flatMap(t=>[t.source,t.edited,t.markdown].filter(p=>p&&path.isAbsolute(p))),...models, runtimePath(),state.settings.cloudCli].filter(Boolean);return paths.flatMap(p=>{try{return [p,fs.realpathSync(p)];}catch{return [p];}});}
 function candidateSafe(item){
  if(!path.isAbsolute(item.path)||!noLinks(item.path)||item.path===path.parse(item.path).root||item.path===dataRoot)return false;
  if(!within(item.path,item.root)||path.resolve(item.path)===path.resolve(item.root))return false;
  // Source documents, result Markdown, edits, executables and configured model trees win over cleanup.
  if(protectedPaths().some(p=>within(p,item.path)))return false;
  if(item.kind!=='partial'&&Object.values(modelConfig()['models-dir']||{}).some(p=>typeof p==='string'&&overlaps(p,item.path)))return false;
  if(state.tasks.some(t=>['queued','running','interrupted'].includes(t.status)&&t.outputDir&&overlaps(t.outputDir,item.path)))return false;
  return true;
 }
 function candidates(){
  const result=[];
  const add=(p,root,kind,label,safe,taskIds=[])=>{if(!fs.existsSync(p))return;const item={path:p,root,kind,label,safe,taskIds};if(!candidateSafe(item))return;const info=treeInfo(p);if(info.links||!info.files)return;result.push({...item,...info,id:crypto.createHash('sha256').update(kind+'|'+p).digest('hex').slice(0,24)});};
  for(const s of ledger.scopes){
   if(s.kind==='temp')add(s.path,path.dirname(s.path),'temp','已结束任务的临时文件',true);
   if(s.kind==='pip-cache')add(s.path,path.dirname(s.path),'pip-cache','安装下载缓存（可重新下载）',true);
   if(s.kind==='model-cache'&&fs.existsSync(s.path)&&noLinks(s.path)){
    let visited=0;
    const visit=p=>{if(++visited>100000)throw Error('模型缓存过大，扫描已停止');for(const e of fs.readdirSync(p,{withFileTypes:true})){if(e.isSymbolicLink())continue;const f=path.join(p,e.name);if(e.name.endsWith('.incomplete')||e.name==='._____temp')add(f,s.path,'partial','未完成模型下载片段（清理后不能续传这些片段）',true);else if(e.isDirectory())visit(f);}};
    visit(s.path);
   }
  }
  for(const t of state.tasks){if(!['failed','canceled'].includes(t.status)||!t.outputDir||t.resourcesCleaned)continue;
   // Legacy task directory identity is checked too; no arbitrary output root deletion.
   if(path.dirname(t.outputDir)!==path.resolve(t.outputRoot)||!path.basename(t.outputDir).endsWith('_'+t.id.slice(0,8)))continue;
   if(state.tasks.some(x=>x.id!==t.id&&x.outputDir===t.outputDir&&['completed','reused','running','queued','interrupted'].includes(x.status)))continue;
   if(fs.existsSync(t.outputDir)&&treeFiles(t.outputDir).some(p=>/\.edited\.md(?:\.previous)?$/i.test(p)))continue;
   add(t.outputDir,t.outputRoot,'failed-output','失败 / 取消任务的输出残留（可能有可用片段）',false,[t.id]);
  }
  // Avoid duplicate or nested deletions from historical path settings.
  return result.filter((r,i,a)=>!a.some((x,j)=>j!==i&&within(r.path,x.path)&&(r.path!==x.path||j<i)));
 }
 function treeFiles(root){const out=[];function visit(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){if(e.isSymbolicLink())continue;const f=path.join(p,e.name);if(e.isDirectory())visit(f);else out.push(f);}}visit(root);return out;}
 function overview(){
  const paths=[['模型下载',state.settings.modelRoot],['临时缓存 / 新安装环境',state.settings.workRoot],['默认转换结果',state.settings.outputRoot],['任务记录 / 配置',dataRoot]];
  const seen=new Set(paths.map(x=>path.resolve(x[1])));
  for(const s of ledger.scopes.filter(s=>['model-cache','work'].includes(s.kind)))if(![...seen].some(p=>within(s.path,p))){paths.push(['以前使用的缓存目录',s.path]);seen.add(s.path);}
  const runtime=runtimePath();if(runtime&&fs.existsSync(runtime))paths.push(['正在使用的本地环境（不自动迁移或清理）',runtime.endsWith('.py')?path.dirname(runtime):path.dirname(path.dirname(runtime))]);
  return {locations:paths.map(([label,p])=>{try{return {label,path:p,...treeInfo(p),...diskInfo(p)};}catch(e){return {label,path:p,bytes:null,error:e.message,...diskInfo(p)};}}),busy:busy(),history:ledger.history.slice(-10).reverse()};
 }
 function scan(){if(busy())throw Error('转换、下载、安装或服务仍在运行；请停止后再扫描清理项');const items=candidates();plan={id:crypto.randomUUID(),createdAt:Date.now(),items};return {...overview(),planId:plan.id,items,safeBytes:items.filter(i=>i.safe).reduce((n,i)=>n+i.bytes,0)};}
 function clean({planId,ids,confirm}){
  if(busy())throw Error('当前有任务或服务运行，不能清理');
  if(!plan||plan.id!==planId||Date.now()-plan.createdAt>10*60*1000)throw Error('清理预览已过期，请重新扫描');
  if(confirm!=='DELETE_REBUILDABLE_RESOURCES'||!Array.isArray(ids)||!ids.length)throw Error('请先选择并确认清理范围');
  const chosen=[...new Set(ids)].map(id=>{const item=plan.items.find(x=>x.id===id);if(!item)throw Error('无效清理项');return item;});
  const fresh=candidates();
  for(const item of chosen){const now=fresh.find(x=>x.id===item.id);if(!now||now.stamp!==item.stamp||!candidateSafe(item))throw Error('文件或引用已变化，请重新扫描后确认');}
  const report={at:new Date().toISOString(),bytes:0,removed:[],errors:[]};
  for(const item of chosen){try{fs.rmSync(item.path,{recursive:true});report.bytes+=item.bytes;report.removed.push({path:item.path,bytes:item.bytes,kind:item.kind});for(const id of item.taskIds){const t=state.tasks.find(t=>t.id===id);t.resourcesCleaned=report.at;t.log=(t.log||'')+'\n输出残留已由存储管理清理。\n';}}catch(e){report.errors.push({path:item.path,error:e.message});}}
  ledger.history.push(report);ledger.history=ledger.history.slice(-30);persist();save();plan=null;return report;
 }
 function finish(temp,success){if(!success||!state.settings.autoCleanTemp)return;const s=ledger.scopes.find(s=>s.kind==='temp'&&s.path===temp);if(!s)return;const item={path:temp,root:path.dirname(temp),kind:'temp'};if(candidateSafe(item)&&fs.existsSync(temp)&&!treeInfo(temp).links){try{fs.rmSync(temp,{recursive:true});}catch{ /* scanner can retry after file handles close */ }}}
 return {prepare,finish,overview,scan,clean,scope,diskInfo};
}
