// Native Electron tray/window smoke check, isolated from the user's task service.
const {app,BrowserWindow,Tray,Menu}=require('electron');
const {createWindowLifecycle}=require('../window-lifecycle.cjs');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-native-tray-'));
app.setPath('userData',data);app.disableHardwareAcceleration();
let win,control;
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:false,width:500,height:300});await win.loadURL('data:text/html,<h1>Isolated tray check</h1>');
 const answers=[];let stopped=0;
 control=createWindowLifecycle({app,win,Tray,Menu,dialog:{showMessageBox:async()=>answers.shift()||{response:0}},icon:path.join(__dirname,'../packaging/app-icon.ico'),preferencesFile:path.join(data,'preferences.json'),hasUnsaved:async()=>false,isBusy:async()=>false,stopBackend:async()=>stopped++});
 assert.equal(control.snapshot().trayAvailable,true);
 answers.push({response:0,checkboxChecked:true});await control.close();assert.equal(win.isVisible(),false);assert.equal(win.isDestroyed(),false);
 control.tray.emit('click');assert.equal(win.isVisible(),true);
 answers.push({response:0,checkboxChecked:true});await control.configure();assert.equal(control.snapshot().closeAction,'ask');
 win.minimize();await new Promise(r=>setTimeout(r,200));assert.equal(win.isVisible(),false);
 control.show();assert.equal(win.isVisible(),true);assert.equal(win.isMinimized(),false);
 app.once('will-quit',()=>{assert.equal(stopped,1);console.log('PASS: native Tray creation, hide/restore, minimize event, preferences, clean quit');});
 await control.requestQuit();
}).catch(e=>{console.error(e);control?.tray?.destroy();win?.destroy();app.exit(1);});
