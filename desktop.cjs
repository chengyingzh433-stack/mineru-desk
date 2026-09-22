const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {bundleRoot,workspaceRoot,installed}=require('./portable.cjs');
const {createUpdater,RELEASES}=require('./updater.cjs');
const smoke=process.argv.includes('--smoke-test');
if(smoke&&!process.env.MINERU_DESK_DATA)process.env.MINERU_DESK_DATA=path.join(__dirname,'test-output','smoke-data');
const dataRoot=process.env.MINERU_DESK_DATA||(workspaceRoot?path.join(workspaceRoot,'data'):path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'MinerU-Desk'));
if(bundleRoot)app.setPath('userData',path.join(dataRoot,'desktop'));
let win,connection;
let maintaining=false;
async function serviceRequest(route,body){
 const response=await fetch(`http://127.0.0.1:${connection.port}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const value=await response.json();if(!response.ok)throw Error(value.error||'任务服务请求失败');return value;
}
const updater=createUpdater({current:require('./package.json').version,directory:async()=>{
 const state=await serviceRequest('state');const root=path.resolve(state.settings.workRoot,'updates');
 if(bundleRoot&&(root===bundleRoot||root.startsWith(bundleRoot+path.sep)))throw Error('请先将缓存目录移到程序安装目录之外');return root;
}});
function trusted(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('只允许桌面主窗口执行此操作');}
function requireInstalled(){if(process.platform!=='win32'||!installed||!bundleRoot||!fs.existsSync(path.join(bundleRoot,'unins000.exe')))throw Error('此功能用于 Windows 安装版；源码或便携版请使用项目发布页的安装程序。');}
async function maintain(operation){
 requireInstalled();if(maintaining)throw Error('正在准备更新或卸载');
 if(['downloading','checking'].includes(updater.snapshot().status))throw Error('请先完成或取消更新下载');
 if(await win.webContents.executeJavaScript('Boolean(window.__mineruUnsaved?.())'))throw Error('请先保存正在编辑的 Markdown 和设置');
 const payload=operation==='update'?await updater.verifiedInstaller():null;
 const state=await serviceRequest('state');const services=await serviceRequest('services');
 if(state.tasks.some(t=>['queued','running'].includes(t.status))||state.modelsJob?.status==='running'||services.some(s=>s.status==='running'))throw Error('还有转换、下载或服务在运行，请先结束这些工作。');
 const result=await dialog.showMessageBox(win,{type:'question',buttons:['取消',operation==='update'?'安装更新':'打开卸载程序'],defaultId:0,cancelId:0,title:operation==='update'?'更新 MinerU Desk':'卸载 MinerU Desk',message:operation==='update'?`安装 ${payload.version}，覆盖当前程序，无需先卸载。`:'卸载桌面程序和随包 MinerU、Python、CPU 依赖。',detail:`程序目录：${bundleRoot}\n模型、论文、转换结果、设置和任务记录默认保留。\n${operation==='update'?'已校验 SHA-256；安装程序尚未做代码签名。':'你另外安装的 MinerU 环境不在卸载范围内。'}`});
 if(result.response!==1)return {canceled:true};
 if(await win.webContents.executeJavaScript('Boolean(window.__mineruUnsaved?.())'))throw Error('还有未保存的修改，请先保存。');
 maintaining=true;win.setEnabled(false);
 try{
  const jobs=path.join(dataRoot,'maintenance');fs.mkdirSync(jobs,{recursive:true});
  const script=path.join(jobs,'maintenance-runner.ps1');fs.copyFileSync(path.join(__dirname,'packaging/maintenance-runner.ps1'),script);
  await serviceRequest('shutdown',{});
  let stopped=false;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));try{await serviceRequest('identity');}catch{stopped=true;break;}}
  if(!stopped)throw Error('后台服务尚未退出，已取消操作');
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-ParentProcessId',String(process.pid),'-InstallRoot',bundleRoot,'-Operation',operation];
  if(payload)args.push('-Installer',payload.file,'-ExpectedHash',payload.sha256);
  const child=spawn('powershell.exe',args,{detached:true,windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  app.quit();return {started:true};
 }catch(e){maintaining=false;win.setEnabled(true);connection=await ensureService();await win.loadURL(`http://127.0.0.1:${connection.port}/#token=${connection.token}`);throw e;}
}
ipcMain.handle('system-info',event=>{trusted(event);return {version:require('./package.json').version,installed:!!(installed&&bundleRoot&&fs.existsSync(path.join(bundleRoot,'unins000.exe'))),releaseUrl:RELEASES,update:updater.snapshot()};});
ipcMain.handle('update-check',event=>{trusted(event);return updater.check();});
ipcMain.handle('update-download',event=>{trusted(event);requireInstalled();if(maintaining)throw Error('正在维护程序');return updater.download();});
ipcMain.handle('update-cancel',event=>{trusted(event);updater.cancel();return {ok:true};});
ipcMain.handle('update-install',event=>{trusted(event);return maintain('update');});
ipcMain.handle('system-uninstall',event=>{trusted(event);return maintain('uninstall');});
async function connected(){try{const info=JSON.parse(fs.readFileSync(path.join(dataRoot,'connection.json'),'utf8'));const r=await fetch(`http://127.0.0.1:${info.port}/api/identity`,{headers:{Authorization:'Bearer '+info.token},signal:AbortSignal.timeout(1500)});if(!r.ok)return null;const identity=await r.json();if(identity.appRoot!==__dirname||identity.version!==require('./package.json').version)throw Error('已有其他版本服务使用此数据目录，请先停止旧服务。');return info;}catch(e){if(e.message?.includes('已有其他版本'))throw e;return null;}}
async function ensureService(){const existing=await connected();if(existing)return existing;fs.mkdirSync(dataRoot,{recursive:true});const file=fs.openSync(path.join(dataRoot,'service.log'),'a');const child=spawn(process.execPath,[path.join(__dirname,'server.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',MINERU_DESK_DATA:dataRoot},detached:!smoke,windowsHide:true,stdio:['ignore',file,file]});child.unref();fs.closeSync(file);for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,150));const found=await connected();if(found)return found;}throw Error('本地任务服务未启动，请查看 '+path.join(dataRoot,'service.log'));}
async function createWindow(){
 connection=await ensureService();
 win=new BrowserWindow({title:'MinerU Desk',icon:path.join(__dirname,'web/app-icon.png'),width:1440,height:930,minWidth:1120,minHeight:720,show:!smoke,backgroundColor:'#f7f8fa',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return {action:'deny'};});
 win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==`http://127.0.0.1:${connection.port}`)event.preventDefault();});
 win.webContents.on('will-prevent-unload',event=>{const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['继续编辑','放弃修改并关闭'],defaultId:0,cancelId:0,message:'有尚未保存的 Markdown 修改。'});if(choice===1)event.preventDefault();});
 await win.loadURL(`http://127.0.0.1:${connection.port}/#token=${connection.token}`);
 if(smoke){
  const output=process.env.MINERU_DESK_SMOKE_OUTPUT||path.join(__dirname,'test-output');
  fs.mkdirSync(output,{recursive:true});
  await new Promise(r=>setTimeout(r,1800));
  fs.writeFileSync(path.join(output,'workspace.png'),(await win.webContents.capturePage()).toPNG());
  const result=await win.webContents.executeJavaScript(`({title:document.title,heading:document.querySelector('h1')?.textContent,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent.trim()),errors:window.__errors||[]})`);
  console.log(JSON.stringify(result));
  if(process.env.MINERU_DESK_SMOKE_RESULT){
   await win.webContents.executeJavaScript(`document.querySelector('[data-action="result"]')?.click()`);
   await new Promise(r=>setTimeout(r,600));
   const content=await win.webContents.executeJavaScript(`document.querySelector('#main').textContent`);
   if(!content.includes('Physics Education'))throw Error('Result preview did not render the converted document');
   if(process.env.MINERU_DESK_SMOKE_IMAGES){
    let loaded=false;for(let i=0;i<30;i++){loaded=await win.webContents.executeJavaScript(`!!document.querySelector('.reader img')&&[...document.querySelectorAll('.reader img')].every(i=>i.complete&&i.naturalWidth>0)`);if(loaded)break;await new Promise(r=>setTimeout(r,100));}
    if(!loaded)throw Error('Converted images did not load in the Markdown reader');
    console.log('PASS: actual converted image loaded in Markdown preview');
   }
   fs.writeFileSync(path.join(output,'result.png'),(await win.webContents.capturePage()).toPNG());
   console.log('PASS: converted document rendered in desktop result preview');
  }
  await win.webContents.executeJavaScript(`document.querySelector('[data-nav="settings"]').click()`);
  await new Promise(r=>setTimeout(r,300));
  fs.writeFileSync(path.join(output,'settings.png'),(await win.webContents.capturePage()).toPNG());
  process.kill(connection.pid);app.exit(0);
 }
}
ipcMain.handle('pick-files',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'文档与图片',extensions:['pdf','png','jpg','jpeg','webp','bmp','jp2','gif','doc','docx','ppt','pptx','xls','xlsx','html']},{name:'全部文件',extensions:['*']}]});return r.canceled?[]:r.filePaths;});
ipcMain.handle('pick-directory',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];});
ipcMain.handle('pick-executable',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'可执行文件',extensions:['exe']}]});return r.canceled?null:r.filePaths[0];});
ipcMain.handle('open-path',async(_e,p)=>{if(typeof p!=='string'||!path.isAbsolute(p))throw Error('请选择本地路径');return shell.openPath(p);});
ipcMain.handle('external',async(_e,url)=>{if(!/^https:\/\/(mineru.net|github.com|opendatalab.github.io|www.python.org)(\/|$)/.test(url)&&!/^http:\/\/127\.0\.0\.1:\d+(\/|$)/.test(url))throw Error('无效的帮助链接');return shell.openExternal(url);});
if(!app.requestSingleInstanceLock()&&!smoke)app.quit();else {app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});app.whenReady().then(createWindow).catch(e=>{dialog.showErrorBox('MinerU Desk 启动失败',e.stack||e.message);app.exit(1);});}
app.on('window-all-closed',()=>app.quit());
