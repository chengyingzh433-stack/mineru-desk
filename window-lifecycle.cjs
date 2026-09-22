const fs=require('node:fs');
const path=require('node:path');

function loadPreferences(file){
 try {const value=JSON.parse(fs.readFileSync(file,'utf8'));return {closeAction:['ask','tray','quit'].includes(value.closeAction)?value.closeAction:'ask',minimizeToTray:value.minimizeToTray!==false};}
 catch{return {closeAction:'ask',minimizeToTray:true};}
}

// Owns only the window and tray lifecycle. Backend shutdown remains authenticated
// and independently rejects active work, including races after the first check.
function createWindowLifecycle({app,win,Tray,Menu,dialog,icon,preferencesFile,hasUnsaved,isBusy,stopBackend,isMaintaining=()=>false}){
 let preferences=loadPreferences(preferencesFile),tray=null,allowQuit=false,pending=false,notified=false;
 function show(){if(win.isDestroyed())return;win.setSkipTaskbar(false);if(win.isMinimized())win.restore();win.show();win.focus();}
 async function message(options){show();return dialog.showMessageBox(win,options);}
 function save(next){
  const temp=preferencesFile+'.tmp';fs.mkdirSync(path.dirname(preferencesFile),{recursive:true});
  fs.writeFileSync(temp,JSON.stringify(next,null,2));fs.renameSync(temp,preferencesFile);preferences=next;refreshMenu();
 }
 function error(e){show();dialog.showMessageBox(win,{type:'error',message:'操作未完成',detail:e.message,buttons:['知道了']}).catch(()=>{});}
 function hide(){
  if(!tray||tray.isDestroyed()){show();return false;}
  win.setSkipTaskbar(true);win.hide();
  if(!notified){notified=true;try{tray.displayBalloon?.({icon,title:'MinerU Desk 仍在运行',content:'点击右下角图标恢复窗口；右键菜单可退出。图标也可能在“^”隐藏图标里。'});}catch{}}
  return true;
 }
 async function quit(){
  if(await isBusy()){
   const answer=await message({type:'info',title:'还有任务在运行',message:'转换、下载或服务尚未结束，暂不退出。',detail:'可先最小化到托盘，或回到窗口处理任务后再退出。',buttons:['最小化到托盘','返回窗口'],defaultId:0,cancelId:1});
   if(answer.response===0)hide();return false;
  }
  if(await hasUnsaved()){
   const answer=await message({type:'warning',title:'尚未保存',message:'有未保存的 Markdown、设置或 Token。',buttons:['返回保存','放弃修改并退出'],defaultId:0,cancelId:0});
   if(answer.response!==1)return false;
  }
  // Block new renderer submissions while the backend atomically checks idle and
  // stops. Do not use app.exit(), which would bypass cleanup and discard guards.
  win.setEnabled(false);
  try{await stopBackend();allowQuit=true;app.quit();return true;}
  catch(e){win.setEnabled(true);throw e;}
 }
 async function run(action){
  if(pending||isMaintaining()||allowQuit)return false;pending=true;
  try{return await action();}catch(e){error(e);return false;}finally{pending=false;}
 }
 async function close(){return run(async()=>{
  let action=preferences.closeAction;
  if(action==='ask'){
   const answer=await message({type:'question',title:'关闭 MinerU Desk',message:'关闭窗口后要怎么做？',detail:'最小化到托盘：保留窗口内容，转换和下载继续。\n退出程序：关闭窗口并停止空闲后台。',buttons:['最小化到托盘','退出程序','取消'],defaultId:0,cancelId:2,checkboxLabel:'记住我的选择（可在应用设置中修改）',checkboxChecked:false});
   if(answer.response===2)return false;action=answer.response===0?'tray':'quit';
   if(answer.checkboxChecked)save({...preferences,closeAction:action});
  }
  return action==='tray'?hide():quit();
 });}
 async function configure(){return run(async()=>{
  const answer=await message({type:'question',title:'窗口与托盘设置',message:'点击右上角 × 时',detail:'选择默认动作。“每次询问”会在关闭窗口时提供最小化和退出选项。',buttons:['每次询问','最小化到托盘','退出程序','取消'],defaultId:{ask:0,tray:1,quit:2}[preferences.closeAction],cancelId:3,checkboxLabel:'点击最小化按钮时也收起到托盘',checkboxChecked:preferences.minimizeToTray});
  if(answer.response===3)return false;save({closeAction:['ask','tray','quit'][answer.response],minimizeToTray:answer.checkboxChecked});return true;
 });}
 function refreshMenu(){if(!tray||tray.isDestroyed())return;tray.setContextMenu(Menu.buildFromTemplate([
  {label:'打开 MinerU Desk',click:show},
  {label:'最小化到托盘',click:()=>{if(!pending&&!isMaintaining())hide();}},
  {type:'separator'},
  {label:'窗口与托盘设置…',click:()=>void configure()},
  {label:'退出 MinerU Desk',click:()=>void run(quit)},
 ]));}
 try{
  tray=new Tray(icon);tray.setToolTip('MinerU Desk');refreshMenu();
  tray.on('click',show);tray.on('double-click',show);tray.on('balloon-click',show);
 }catch(e){tray?.destroy();tray=null;throw Error('无法创建托盘图标：'+e.message);}
 win.on('close',event=>{if(allowQuit||isMaintaining())return;event.preventDefault();void close();});
 win.on('minimize',event=>{if(preferences.minimizeToTray&&!pending&&!allowQuit&&!isMaintaining()){event.preventDefault();hide();}});
 app.on('before-quit',event=>{if(allowQuit||isMaintaining())return;event.preventDefault();void run(quit);});
 app.on('will-quit',()=>{tray?.destroy();tray=null;});
 return {show,hide,close,configure,requestQuit:()=>run(quit),canUnload:()=>allowQuit||isMaintaining(),snapshot:()=>({...preferences,trayAvailable:!!tray&&!tray.isDestroyed()}),tray};
}
module.exports={createWindowLifecycle,loadPreferences};
