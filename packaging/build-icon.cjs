// Render the editable SVG using the bundled Electron, then emit a multi-size ICO.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:256,height:256,show:false,frame:false,transparent:true,webPreferences:{offscreen:true}});
 const painted=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Icon paint timed out')),10000);win.webContents.once('paint',(_event,_dirty,image)=>{clearTimeout(timer);resolve(image);});});
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:256px;height:256px;overflow:hidden;background:transparent}svg{width:256px;height:256px}</style>'+fs.readFileSync(path.join(__dirname,'../web/app-icon.svg'),'utf8')));
 const picture=await painted;const sizes=[16,24,32,48,64,128,256];const frames=sizes.map(n=>picture.resize({width:n,height:n,quality:'best'}).toPNG());
 const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
 sizes.forEach((n,i)=>{const base=6+i*16;header[base]=header[base+1]=n===256?0:n;header.writeUInt16LE(1,base+4);header.writeUInt16LE(32,base+6);header.writeUInt32LE(frames[i].length,base+8);header.writeUInt32LE(offset,base+12);offset+=frames[i].length;});
 fs.writeFileSync(path.join(__dirname,'app-icon.ico'),Buffer.concat([header,...frames]));fs.writeFileSync(path.join(__dirname,'../web/app-icon.png'),picture.toPNG());app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
