import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import portable from './portable.cjs';
export const bundleRoot=portable.bundleRoot;
export const workspaceRoot=portable.workspaceRoot;
export const installed=portable.installed;

export const dataRoot = process.env.MINERU_DESK_DATA || (workspaceRoot?path.join(workspaceRoot,'data'):path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'MinerU-Desk'));
export const supported = ['.pdf','.png','.jpg','.jpeg','.jp2','.webp','.gif','.bmp','.doc','.docx','.ppt','.pptx','.xls','.xlsx','.html'];
export const backends = ['pipeline','hybrid-engine','vlm-engine','hybrid-http-client','vlm-http-client'];
export const defaults = { outputRoot: workspaceRoot?path.join(workspaceRoot,'output'):path.join(os.homedir(), 'Documents', 'MinerU转换结果'), modelRoot: workspaceRoot?path.join(workspaceRoot,'models'):path.join(dataRoot, 'models'), workRoot:workspaceRoot?path.join(workspaceRoot,'cache'):path.join(dataRoot,'work'), autoCleanTemp:true, minFreeGB:1, mineru: '', cloudCli: '', serverUrl: '', vlmUrl: '', modelSource: 'modelscope', offline: !!bundleRoot, maxJobs: 1 };
export const optionDefaults = { provider:'local', backend:'pipeline', cloudMode:'extract', method:'auto', language:'ch', formula:true, table:true, imageAnalysis:false, effort:'medium', pages:'', formats:['md','json'], timeout:3600, force:false, extraArgs:[], env:{} };
export function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } }
export function writeJson(file, value) { fs.mkdirSync(path.dirname(file),{recursive:true}); const temp=file+'.'+crypto.randomUUID()+'.tmp'; fs.writeFileSync(temp,JSON.stringify(value,null,2)); fs.renameSync(temp,file); }
export function within(file, root) { const relative=path.relative(path.resolve(root),path.resolve(file)); return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative); }
export function assertUrl(value) { const url=new URL(value); if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw Error('服务地址必须是 HTTP/HTTPS 地址，且不能包含密码'); return url.href.replace(/\/$/,''); }
export async function digestFile(file) { const hash=crypto.createHash('sha256'); for await(const chunk of fs.createReadStream(file))hash.update(chunk); return hash.digest('hex'); }
function stable(value) { if(Array.isArray(value)) return value.map(stable); if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])); return value; }
export function cacheKey(digest, options, settings, version) { const {force,...conversion}=options; return crypto.createHash('sha256').update(JSON.stringify(stable({digest,conversion,version,server:options.provider==='server'?settings.serverUrl:'',vlmUrl:options.backend.endsWith('http-client')?settings.vlmUrl:'',modelSource:settings.modelSource,offline:settings.offline,modelRoot:settings.modelRoot}))).digest('hex'); }
export function scanFiles(dir, max=2000) { const found=[]; function visit(root) { for(const entry of fs.readdirSync(root,{withFileTypes:true})) { if(found.length>=max)break; if(entry.isSymbolicLink())continue; const p=path.join(root,entry.name); if(entry.isDirectory())visit(p); else if(supported.includes(path.extname(p).toLowerCase()))found.push(p); } } visit(dir); return found; }
export function allFiles(root) { const files=[]; if(!fs.existsSync(root))return files; for(const entry of fs.readdirSync(root,{withFileTypes:true})) { const p=path.join(root,entry.name); if(entry.isSymbolicLink())continue; if(entry.isDirectory())files.push(...allFiles(p)); else files.push(p); } return files; }
export function findExecutable(settings, kind) {
  const configured=kind==='local'?settings.mineru:settings.cloudCli;
  if(configured) { if(!fs.existsSync(configured))throw Error('找不到设置中的程序：'+configured); return configured; }
  if(kind==='local'&&bundleRoot){const file=path.join(bundleRoot,'runtime','mineru-cli.py');return fs.existsSync(file)?file:null;}
  const candidates=kind==='local' ? [process.env.MINERU_EXECUTABLE,path.join(dataRoot,'runtime/Scripts/mineru.exe'),path.join(os.homedir(),'.codex/skills/cyz-edu-research/.venv-mineru/Scripts/mineru.exe')]
    : [path.join(path.dirname(fileURLToPath(import.meta.url)),'node_modules/mineru-open-api-win32-x64/bin/mineru-open-api.exe'),path.join(path.dirname(fileURLToPath(import.meta.url)),'node_modules/mineru-open-api/node_modules/mineru-open-api-win32-x64/bin/mineru-open-api.exe'),path.join(dataRoot,'cloud/node_modules/mineru-open-api/node_modules/mineru-open-api-win32-x64/bin/mineru-open-api.exe'),path.join(process.env.APPDATA||'', 'npm/node_modules/mineru-open-api/node_modules/mineru-open-api-win32-x64/bin/mineru-open-api.exe')];
  const name=kind==='local'?'mineru':'mineru-open-api';
  for(const base of (process.env.PATH||'').split(path.delimiter)) candidates.push(path.join(base,name+(process.platform==='win32'?'.exe':'')));
  return candidates.find(p=>p&&fs.existsSync(p)) || null;
}
export function runProcess(exe,args,{env={},cwd,onLog=()=>{},timeout=0,onSpawn=()=>{}}={}) {
  if(/mineru-[\w-]+\.py$/i.test(exe)){args=[exe,...args];exe=path.join(path.dirname(exe),'python.exe');}
  return new Promise((resolve,reject)=>{
    const noProxy=[process.env.NO_PROXY||process.env.no_proxy||'','127.0.0.1','localhost','::1'].filter(Boolean).join(',');
    const child=spawn(exe,args,{shell:false,windowsHide:true,cwd,env:{...process.env,NO_PROXY:noProxy,no_proxy:noProxy,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',...env},stdio:['ignore','pipe','pipe']});
    onSpawn(child); let output=''; let killed=false; let timer;
    const append=chunk=>{const text=chunk.toString('utf8'); output=(output+text).slice(-100000);onLog(text);};
    child.stdout.on('data',append);child.stderr.on('data',append);
    if(timeout)timer=setTimeout(()=>{killed=true;killProcess(child);},timeout*1000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer); if(code===0&&!killed)resolve(output);else reject(Error(killed?'任务超时，已停止本地进程':`命令退出 ${code}\n${output.slice(-6000)}`));});
  });
}
export function localTool(runtime,name){return path.join(path.dirname(runtime),name+(runtime.endsWith('.py')?'.py':process.platform==='win32'?'.exe':''));}
export function killProcess(child) { if(!child?.pid)return; if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}); else child.kill('SIGTERM'); }
export function validateOptions(input, file, settings) {
  const o={...optionDefaults,...input};
  if(o.provider!=='cloud')o.formats=['md','json'];
  if(!['local','cloud','server'].includes(o.provider))throw Error('无效的运行方式');
  if(!backends.includes(o.backend))throw Error('无效的解析后端');
  if(!['auto','txt','ocr'].includes(o.method)||!['medium','high'].includes(o.effort))throw Error('无效的识别设置');
  if(!['extract','flash-extract','crawl'].includes(o.cloudMode))throw Error('无效的云端模式');
  if(o.cloudModel&&!['vlm','pipeline','html'].includes(o.cloudModel))throw Error('无效的云端模型');
  if(o.provider==='cloud'&&o.cloudMode==='crawl'&&o.formats.some(x=>!['md','json','html'].includes(x)))throw Error('网页提取仅支持 MD / JSON / HTML');
  if(!Array.isArray(o.formats)||!o.formats.length||o.formats.some(x=>!['md','json','html','latex','docx'].includes(x)))throw Error('请至少选择一个支持的输出格式');
  if(!Number.isFinite(Number(o.timeout))||o.timeout<30||o.timeout>86400)throw Error('超时须在 30–86400 秒之间');
  if(!/^[a-z_]+$/.test(o.language))throw Error('无效的语言代码');
  if(o.pages&&!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(o.pages))throw Error('页码格式示例：1-10 或 1-10,15');
  if(o.pages&&o.pages.split(',').some(p=>{const [a,b=a]=p.split('-').map(Number);return a<1||b<a;}))throw Error('页码从 1 开始，结束页不能小于起始页');
  if(o.provider!=='cloud'&&o.pages.includes(','))throw Error('本地后端支持连续页码，例如 1-10');
  if(o.provider!=='cloud'&&o.formats.some(x=>!['md','json'].includes(x)))throw Error('本地 MinerU 提供 Markdown / JSON 和图片；额外格式请使用云端精准解析');
  if(o.provider==='local'&&o.backend.endsWith('http-client'))throw Error('HTTP 推理后端请切换到自建服务');
  if(o.provider==='server') { if(settings.serverUrl)assertUrl(settings.serverUrl); if(o.backend.endsWith('http-client'))assertUrl(settings.vlmUrl); else if(!settings.serverUrl)throw Error('请先配置自建 MinerU API 地址'); }
  const isUrl=/^https?:\/\//.test(file);
  if(isUrl) { assertUrl(file);if(o.provider!=='cloud')throw Error('URL 输入请使用官方云端'); }
  else { if(!path.isAbsolute(file)||!fs.statSync(file).isFile())throw Error('请选择一个存在的文件'); const ext=path.extname(file).toLowerCase(); if(!supported.includes(ext))throw Error('暂不支持该文件类型'); if(o.provider!=='cloud'&&['.doc','.ppt','.xls','.html'].includes(ext))throw Error('旧版 Office / HTML 文件请使用云端精准解析，或先另存为新格式'); if(o.provider==='cloud'&&o.cloudMode==='flash-extract'&&fs.statSync(file).size>10*1024*1024)throw Error('快速模式文件不得超过 10 MB，请改用精准解析'); }
  if(o.provider==='cloud'&&o.cloudMode==='crawl'&&!isUrl)throw Error('网页提取需要 HTTP/HTTPS URL');
  if(o.provider==='cloud'&&o.cloudMode==='flash-extract'&&o.formats.some(x=>x!=='md'))throw Error('云端快速模式仅支持 Markdown');
  if(!Array.isArray(o.extraArgs)||o.extraArgs.some(x=>typeof x!=='string'))throw Error('高级参数必须是 JSON 字符串数组');
  if(o.extraArgs.some(x=>/^(-p|-o|-b|-m|-u|-s|-e|-l|-f|-t|--path|--output|--backend|--method|--url|--api-url|--token|--base-url|--start|--end|--formula|--table|--image-analysis|--effort|--lang|--client-side-output-generation)(=|$)/.test(x)))throw Error('路径、后端和识别参数请使用对应的界面选项');
  if(!o.env||typeof o.env!=='object'||Array.isArray(o.env)||Object.entries(o.env).some(([k,v])=>!(/^(MINERU_[A-Z0-9_]+|CUDA_VISIBLE_DEVICES|OMP_NUM_THREADS)$/.test(k))||typeof v!=='string'||/KEY|TOKEN|SECRET|CONFIG|SOURCE|OUTPUT_ROOT/.test(k)))throw Error('高级环境变量仅接受 MinerU 计算参数；密钥和路径请在设置中填写');
  return o;
}
export function buildCommand(file, output, o, settings, runtime) {
  const env={...o.env,MINERU_MODEL_SOURCE:settings.offline?'local':settings.modelSource,HF_HOME:path.join(settings.modelRoot,'huggingface'),MODELSCOPE_CACHE:path.join(settings.modelRoot,'modelscope'),MINERU_TOOLS_CONFIG_JSON:path.join(dataRoot,'mineru.json')};
  if(o.provider==='cloud') {
    const args=[o.cloudMode,file,'-o',output,'--timeout',String(o.timeout)];
    if(o.cloudMode==='extract')args.push('--format',o.formats.join(','),'--model',o.cloudModel||'vlm');
    if(o.cloudMode!=='crawl') { args.push('--language',o.language);if(o.pages)args.push('--pages',o.pages);if(o.method==='ocr')args.push('--ocr');args.push(`--formula=${!!o.formula}`,`--table=${!!o.table}`); }
    else args.push('--format',o.formats.filter(x=>['md','json','html'].includes(x)).join(','));
    return {exe:runtime,args,env:{}};
  }
  const args=['-p',file,'-o',output,'-b',o.backend,'-m',o.method,'-l',o.language,'--formula',String(o.formula),'--table',String(o.table),'--image-analysis',String(o.imageAnalysis),'--effort',o.effort,'--client-side-output-generation',String(!!o.clientOutput)];
  if(o.pages){const [a,b=a]=o.pages.split('-').map(Number);args.push('-s',String(a-1),'-e',String(b-1));}
  if(o.provider==='server') { if(settings.serverUrl)args.push('--api-url',assertUrl(settings.serverUrl));if(o.backend.endsWith('http-client'))args.push('-u',assertUrl(settings.vlmUrl)); }
  args.push(...o.extraArgs);
  return {exe:runtime,args,env};
}
