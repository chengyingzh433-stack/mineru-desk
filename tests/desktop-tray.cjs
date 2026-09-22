// Exercise the production desktop entry point with an isolated backend/data root.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-desktop-tray-'));
app.setPath('userData',data);app.disableHardwareAcceleration();process.env.MINERU_DESK_DATA=data;
const answers=[];let win,c;
dialog.showMessageBox=async(_win,options)=>{if(options.type==='error')throw Error(options.detail);return answers.shift()||{response:0};};
dialog.showErrorBox=(_title,message)=>{console.error(message);app.exit(1);};
require('../desktop.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await pause(100);}throw Error('Desktop tray timeout');}
app.whenReady().then(async()=>{
 await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading();});
 const js=text=>win.webContents.executeJavaScript(text);
 await until(async()=>{try{return (await js('window.deskSystem.info()')).window?.trayAvailable;}catch{return false;}});
 c=JSON.parse(fs.readFileSync(path.join(data,'connection.json')));
 answers.push({response:0});win.close();await until(()=>!win.isVisible());assert.equal(win.isDestroyed(),false);
 app.emit('second-instance');await until(()=>win.isVisible());
 await js(`document.querySelector('[data-nav="settings"]').click()`);
 await until(()=>js(`!!document.querySelector('#cloud-token')`));
 await js(`document.querySelector('#cloud-token').value='synthetic-draft';`);
 answers.push({response:1},{response:0});win.close();await pause(300);assert.equal(win.isVisible(),true);assert.equal(win.isDestroyed(),false);
 await js(`document.querySelector('#cloud-token').value='';`);
 app.once('will-quit',()=>{console.log('PASS: production close -> tray -> second instance restore; unsaved Token blocks quit; idle backend shutdown');console.log('TEST_DATA '+data);});
 answers.push({response:1});win.close();
}).catch(async e=>{console.error(e);if(c){try{await fetch(`http://127.0.0.1:${c.port}/api/shutdown`,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:'{}'});}catch{}}app.exit(1);});
