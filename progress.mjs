// Parse reported backend progress. Never extrapolate a whole-document percentage.
export function parseProgress(text,previous=null){
 let found=null;
 for(const raw of String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').split(/[\r\n]+/)){
  const line=raw.trim();const m=line.match(/^(.*?)\s*(\d{1,3}(?:\.\d+)?)%\s*\|[^|]*\|\s*(.*)$/);
  if(m&&Number(m[2])<=100){found={stage:m[1].replace(/:\s*$/,'').slice(-100)||'后端当前阶段',percent:Number(m[2]),detail:m[3].slice(0,140),reportedAt:new Date().toISOString()};continue;}
  if(!line||line.length>500)continue;
  let stage;
  if(/downloading|download.*model|正在下载/i.test(line))stage='下载模型 / 文件';
  else if(/loading.*model|model.*init|load.*weights/i.test(line))stage='加载模型';
  else if(/processing pages/i.test(line))stage='解析页面';
  else if(/OCR[- ]|ocr predict/i.test(line))stage='文字识别';
  else if(/layout.*predict/i.test(line))stage='版面分析';
  else if(/table.*predict/i.test(line))stage='表格识别';
  else if(/formula.*predict/i.test(line))stage='公式识别';
  else if(/output.*dir|writing.*markdown/i.test(line))stage='整理输出';
  if(stage)found={stage,percent:null,detail:'后端尚未报告该阶段百分比',reportedAt:new Date().toISOString()};
 }
 return found||previous;
}
