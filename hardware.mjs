import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {runProcess,findExecutable} from './core.mjs';

export const reference={checkedAt:'2026-09-13',source:'https://github.com/opendatalab/MinerU#local-deployment',benchmark:'OmniDocBench v1.6 端到端 Overall 分数；不是单篇文档的准确率承诺',rows:[
 {backend:'Pipeline',cpu:'支持纯 CPU',vram:'GPU 加速参考 4 GB；CPU 模式无需独显',ram:'最低 16 GB，推荐 32 GB+',disk:'最低 20 GB，推荐 SSD',score:'86.47'},
 {backend:'Hybrid / VLM Engine',cpu:'不支持纯 CPU',vram:'至少 8 GB',ram:'最低 16 GB，推荐 32 GB+',disk:'最低 20 GB，推荐 SSD',score:'Hybrid high 95.39 / medium 95.26；VLM 95.30'},
 {backend:'Hybrid HTTP Client',cpu:'客户端支持纯 CPU',vram:'客户端 GPU 加速参考 2 GB',ram:'最低 16 GB',disk:'最低 2 GB（轻量客户端）',score:'计算依赖推理服务'},
 {backend:'VLM HTTP Client',cpu:'客户端支持纯 CPU',vram:'客户端无需 GPU',ram:'最低 16 GB',disk:'最低 2 GB（轻量客户端）',score:'计算依赖推理服务'}
]};
export function recommend(h){
 const reasons=[],warnings=[];let provider='local',backend='pipeline';
 if(h.ramGB<16){provider='cloud';reasons.push('可用物理内存总量低于官方 16 GB 本地参考门槛，优先考虑云端或远程服务。');}
 else {
  if(h.torch?.cudaAvailable===true){const capable=h.torch.devices?.some(d=>d.vramGB>=8&&d.capability>=7);if(capable){backend='hybrid-engine';reasons.push('当前 PyTorch 能使用 CUDA，且检测到单卡显存至少 8 GB、计算能力至少 7.0，可尝试 Hybrid 本地解析。');}else reasons.push('已检测到 CUDA，但显存或 GPU 架构未满足本地 Engine 的参考条件，先选 Pipeline。');}
  else reasons.push(h.torch?.cudaAvailable===false?'当前环境未提供可用的 CUDA 加速，先使用 Pipeline 的 CPU 路径。':'CUDA / PyTorch 状态尚未确认，保守建议 Pipeline；未知不等于不支持。');
 }
 if(h.ramGB>=16&&h.ramGB<32)warnings.push('满足 16 GB 基线，但未达到推荐的 32 GB；长文档可分段处理、减少并发。');
 if(!h.python)warnings.push('尚未确认所选 MinerU 的 Python 环境，请先安装或选择本地程序。');
 else {const [major,minor]=h.python.split('.').map(Number);if(major!==3||minor<10||minor>(h.platform==='win32'?12:13))warnings.push('Python 版本不在官方当前参考范围内；Windows 的 ray 依赖限制为 3.10–3.12。');}
 for(const d of h.disks||[])if(d.free!==null&&d.free<20*1024**3)warnings.push(d.label+'所在磁盘不足 20 GB 可用空间，建议先释放空间或更换磁盘。');
 if(backend.endsWith('engine'))warnings.push('GPU 条件只是初筛；仍需模型权重、匹配的 CUDA/驱动和推理框架，需用小文件验证。');
 warnings.push('建议不会自动切换后端、安装依赖或上传文件。HTTP Client 连接 OpenAI 兼容推理服务，与 MinerU 官方云端 API 是不同入口；低配置要求仅适用于客户端，不代表服务器或完整安装包只占 2 GB。');
 return {provider,backend,title:provider==='cloud'?'优先云端 / 远程服务':backend==='pipeline'?'建议先用 Pipeline（兼容性优先）':'可尝试 Hybrid Engine（本地 GPU）',reasons,warnings};
}
export async function detectHardware(settings,diskInfo){
 const h={checkedAt:new Date().toISOString(),platform:process.platform,os:os.type()+' '+os.release(),cpu:os.cpus()[0]?.model||'未知',cores:os.cpus().length,ramGB:Number((os.totalmem()/1024**3).toFixed(2)),freeRamGB:Number((os.freemem()/1024**3).toFixed(2)),adapters:[],python:null,torch:null,notes:[],reference};
 await Promise.all([
  (async()=>{if(process.platform!=='win32')return;try{const raw=await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress"],{timeout:12});const parsed=JSON.parse(raw);h.adapters=(Array.isArray(parsed)?parsed:[parsed]).map(v=>({name:v.Name,driver:v.DriverVersion}));}catch{h.notes.push('无法读取系统显卡列表；显存不使用 Windows 的 32 位 AdapterRAM 字段估算。');}})(),
  (async()=>{try{const exe=findExecutable(settings,'local');if(!exe)return;const py=path.join(path.dirname(exe),process.platform==='win32'?'python.exe':'python');if(!fs.existsSync(py))return;
   const script=['import sys,json,importlib.util','r={"python":sys.version.split()[0]}','try:',' import torch',' r["torch"]={"version":torch.__version__,"cudaBuild":torch.version.cuda,"cudaAvailable":torch.cuda.is_available(),"devices":[]}',' if torch.cuda.is_available():','  for i in range(torch.cuda.device_count()):','   d=torch.cuda.get_device_properties(i)','   r["torch"]["devices"].append({"name":d.name,"vramGB":round(d.total_memory/1024**3,2),"capability":d.major+d.minor/10})','except Exception as e:',' r["torchError"]=str(e)[:400]','print(json.dumps(r))'].join('\n');
   const raw=await runProcess(py,['-c',script],{timeout:25});const parsed=JSON.parse(raw.trim().split(/\r?\n/).findLast(x=>x.startsWith('{')));h.python=parsed.python;h.torch=parsed.torch||null;if(parsed.torchError)h.notes.push('PyTorch 检查：'+parsed.torchError);
  }catch(e){h.notes.push('Python / PyTorch 检查未完成：'+e.message.slice(0,300));}})()
 ]);
 h.disks=[['模型目录',settings.modelRoot],['临时缓存目录',settings.workRoot]].map(([label,p])=>({label,path:p,...diskInfo(p)}));
 h.recommendation=recommend(h);return h;
}
