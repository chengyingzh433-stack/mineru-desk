import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {readJson,within} from './core.mjs';
import {treeInfo} from './storage.mjs';
const ended=t=>['completed','reused','failed','canceled'].includes(t.status);
const local=p=>typeof p==='string'&&path.isAbsolute(p);
const overlap=(a,b)=>within(a,b)||within(b,a);
function noLinks(p){for(let q=path.resolve(p);;q=path.dirname(q)){if(fs.existsSync(q)&&fs.lstatSync(q).isSymbolicLink())return false;if(q===path.dirname(q))return true;}}
export function createTaskMaintenance({state,save,busy,dataRoot,protectedRoots=()=>[]}){
 let plan;
 function choose(ids){if(!Array.isArray(ids)||!ids.length||ids.length>2000)throw Error('请选择 1–2000 条任务');return [...new Set(ids)].map(id=>{const t=state.tasks.find(t=>t.id===id);if(!t)throw Error('任务不存在，请刷新');if(!ended(t))throw Error('运行、排队或待继续的任务不能清理，请先处理');return t;});}
 function archive({ids,restore=false}){const tasks=choose(ids);for(const t of tasks){if(restore)delete t.hiddenAt;else t.hiddenAt=new Date().toISOString();}save();return {count:tasks.length,archived:!restore};}
 const fingerprint=()=>crypto.createHash('sha256').update(JSON.stringify(state.tasks)).digest('hex');
 function inspect({ids,deleteSources=[]}){
  const tasks=choose(ids),chosen=new Set(tasks.map(t=>t.id));
  if(!Array.isArray(deleteSources)||deleteSources.some(p=>!local(p)))throw Error('原文必须按绝对路径逐项选择');
  const sources=[...new Set(deleteSources.map(p=>path.resolve(p)))];
  const other=state.tasks.filter(t=>!chosen.has(t.id));
  const blocked=[],items=[];
  for(const t of other)if(chosen.has(t.reusedFrom))blocked.push('其他任务仍引用这条缓存记录，请一并选择关联任务：'+t.name+' ('+t.id+')');
  const roots=[dataRoot,state.settings.modelRoot,...protectedRoots()].filter(local).map(p=>path.resolve(p));
  const protectedSources=state.tasks.map(t=>t.source).filter(local);
  function add(p,kind){
   if(!fs.existsSync(p))return;
   p=path.resolve(p);if(items.some(x=>x.path===p))return;
   if(!noLinks(p)||roots.some(r=>overlap(p,r))||[path.parse(p).root,os.homedir(),state.settings.workRoot,state.settings.outputRoot].filter(local).some(r=>path.resolve(r)===p)){blocked.push('路径受保护或经过链接：'+p);return;}
   if(kind!=='source'&&protectedSources.some(s=>within(s,p))){blocked.push('目录内含原文，不能整体删除：'+p);return;}
   if(other.some(t=>(local(t.source)&&within(t.source,p))||(local(t.outputDir)&&overlap(t.outputDir,p)))){blocked.push('其他任务仍使用此资源：'+p);return;}
   const info=treeInfo(p);if(info.links){blocked.push('目录内含链接：'+p);return;}items.push({path:p,kind,...info});
  }
  for(const t of tasks){
   if(t.outputDir&&fs.existsSync(t.outputDir)){
    const owner=state.tasks.find(x=>x.outputDir===t.outputDir&&path.basename(t.outputDir).endsWith('_'+x.id.slice(0,8)));
    if(!owner||!chosen.has(owner.id)||path.dirname(path.resolve(t.outputDir))!==path.resolve(owner.outputRoot)){blocked.push('结果目录归属无法确认，或原始缓存任务未选中：'+t.outputDir);continue;}
    add(t.outputDir,'output');
   }
  }
  const ledger=readJson(path.join(dataRoot,'storage-ledger.json'),{scopes:[]});
  for(const s of ledger.scopes||[])if(s.kind==='temp'&&chosen.has(s.owner)){
   const t=tasks.find(t=>t.id===s.owner),work=t.runtimeSettings?.workRoot||state.settings.workRoot;
   if(path.resolve(s.path)===path.resolve(work,'tmp','convert-'+t.id))add(s.path,'temporary');
  }
  for(const source of sources){
   if(path.extname(source).toLowerCase()!=='.pdf'||!tasks.some(t=>local(t.source)&&path.resolve(t.source)===source))throw Error('只允许删除所选任务的原始 PDF');
   if(fs.existsSync(source)&&!fs.lstatSync(source).isFile())throw Error('原文不是普通文件');
   add(source,'source');
  }
  return {ids:tasks.map(t=>t.id),sources,items:items.filter((x,i,a)=>!a.some((y,j)=>i!==j&&within(x.path,y.path))),blocked:[...new Set(blocked)],taskStamp:fingerprint()};
 }
 function preview(body){if(busy())throw Error('转换、下载或服务运行时暂不能预览资源删除');const details=inspect(body);plan={...details,planId:crypto.randomUUID(),createdAt:Date.now()};return {...plan,bytes:plan.items.reduce((n,i)=>n+i.bytes,0)};}
 function purge({planId,confirm,confirmedSources=[],sourceConfirmation=''}){
  if(busy())throw Error('当前有转换、下载或服务运行，不能删除');
  if(!plan||plan.planId!==planId||Date.now()-plan.createdAt>600000)throw Error('删除预览已过期，请重新检查');
  if(confirm!=='DELETE_TASK_RESOURCES')throw Error('请确认删除清单');
  if(!Array.isArray(confirmedSources)||JSON.stringify([...confirmedSources].sort())!==JSON.stringify([...plan.sources].sort())||(plan.sources.length&&sourceConfirmation!=='删除原始PDF'))throw Error('删除原始 PDF 需要逐项勾选并输入“删除原始PDF”');
  const fresh=inspect({ids:plan.ids,deleteSources:plan.sources});
  if(plan.blocked.length||fresh.blocked.length)throw Error((fresh.blocked.length?fresh.blocked:plan.blocked).join('\n'));
  if(fresh.taskStamp!==plan.taskStamp||JSON.stringify(fresh.items)!==JSON.stringify(plan.items))throw Error('任务或文件已经变化，请重新预览');
  const report={at:new Date().toISOString(),taskIds:plan.ids,bytes:0,removed:[],errors:[]};
  for(const item of plan.items){try{fs.rmSync(item.path,{recursive:item.kind!=='source'});report.bytes+=item.bytes;report.removed.push({path:item.path,kind:item.kind});}catch(e){report.errors.push({path:item.path,error:e.message});}}
  if(!report.errors.length)state.tasks=state.tasks.filter(t=>!plan.ids.includes(t.id));
  else for(const t of state.tasks.filter(t=>plan.ids.includes(t.id))){t.resourcesCleaned=report.at;t.log=(t.log||'')+'\n部分资源已清理，请检查清理报告。\n';}
  state.taskCleanupHistory=[...(state.taskCleanupHistory||[]),report].slice(-30);save();plan=null;return report;
 }
 return {archive,preview,purge};
}
