const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {bundleRoot,workspaceRoot}=require('./portable.cjs');
const smoke=process.argv.includes('--smoke-test');
if(smoke&&!process.env.MINERU_DESK_DATA)process.env.MINERU_DESK_DATA=path.join(__dirname,'test-output','smoke-data');
const dataRoot=process.env.MINERU_DESK_DATA||(workspaceRoot?path.join(workspaceRoot,'data'):path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'MinerU-Desk'));
if(bundleRoot)app.setPath('userData',path.join(dataRoot,'desktop'));
let win,connection;
async function connected(){try{const info=JSON.parse(fs.readFileSync(path.join(dataRoot,'connection.json'),'utf8'));const r=await fetch(`http://127.0.0.1:${info.port}/api/identity`,{headers:{Authorization:'Bearer '+info.token},signal:AbortSignal.timeout(1500)});if(!r.ok)return null;const identity=await r.json();if(identity.appRoot!==__dirname||identity.version!==require('./package.json').version)throw Error('已有其他版本服务使用此数据目录，请先停止旧服务。');return info;}catch(e){if(e.message?.includes('已有其他版本'))throw e;return null;}}
async function ensureService(){const existing=await connected();if(existing)return existing;fs.mkdirSync(dataRoot,{recursive:true});const file=fs.openSync(path.join(dataRoot,'service.log'),'a');const child=spawn(process.execPath,[path.join(__dirname,'server.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',MINERU_DESK_DATA:dataRoot},detached:!smoke,windowsHide:true,stdio:['ignore',file,file]});child.unref();fs.closeSync(file);for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,150));const found=await connected();if(found)return found;}throw Error('本地任务服务未启动，请查看 '+path.join(dataRoot,'service.log'));}
async function createWindow(){
 connection=await ensureService();
 win=new BrowserWindow({title:'MinerU Desk',width:1440,height:930,minWidth:1120,minHeight:720,show:!smoke,backgroundColor:'#f7f8fa',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
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
