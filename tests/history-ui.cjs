const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'mineru-history-ui-'));
const serviceData=path.join(data,'state');fs.mkdirSync(serviceData);
const tasks=['11111111-one','22222222-two'].map(id=>{const source=path.join(data,id+'.pdf'),outputRoot=path.join(data,'output'),outputDir=path.join(outputRoot,'paper_'+id.slice(0,8));fs.writeFileSync(source,'Synthetic original');fs.mkdirSync(outputDir,{recursive:true});const markdown=path.join(outputDir,'paper.md');fs.writeFileSync(markdown,'# Synthetic result');return {id,name:id+'.pdf',source,outputRoot,outputDir,markdown,status:'completed',options:{provider:'local',backend:'pipeline'},log:'fixture'};});
fs.writeFileSync(path.join(serviceData,'state.json'),JSON.stringify({settings:{outputRoot:path.join(data,'output'),workRoot:path.join(data,'work'),modelRoot:path.join(data,'models')},tasks}));
let server,win;const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<400;i++){if(await fn())return;await pause(75);}throw Error('UI timed out');}
app.whenReady().then(async()=>{
 server=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',MINERU_DESK_DATA:serviceData},windowsHide:true,stdio:'ignore'});
 await until(()=>fs.existsSync(path.join(serviceData,'connection.json')));const c=JSON.parse(fs.readFileSync(path.join(serviceData,'connection.json')));
 async function state(){return (await fetch(`http://127.0.0.1:${c.port}/api/state`,{headers:{Authorization:'Bearer '+c.token}})).json();}
 win=new BrowserWindow({show:false,width:1440,height:930,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code);const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await win.loadURL(`http://127.0.0.1:${c.port}/#token=${c.token}`);
 await until(()=>js(`!!document.querySelector('[data-action="pick-files"]')`));await click('[data-nav="history"]');
 await until(()=>js(`!!document.querySelector('[data-history-id]')`));
 await click('[data-history-id="11111111-one"]');await click('[data-action="history-clean"]');
 await until(()=>js(`document.querySelector('#dialog').open`));assert.equal(await js(`document.querySelector('#history-clean-mode').value`),'archive');
 assert.equal(await js(`document.querySelectorAll('[data-history-source]:checked').length`),0);
 await click('[data-action="dialog-confirm"]');await until(async()=>!!(await state()).tasks[0].hiddenAt);assert.ok(fs.existsSync(tasks[0].source));assert.ok(fs.existsSync(tasks[0].markdown));
 await until(()=>js(`document.querySelector('#toast').textContent.includes('已移出列表')`));await click('[data-filter="archived"]');await until(()=>js(`document.querySelectorAll('[data-history-id]').length===1&&!!document.querySelector('[data-history-id="11111111-one"]')`));await click('[data-history-id="11111111-one"]');await click('[data-action="history-restore"]');await until(async()=>!(await state()).tasks[0].hiddenAt);await until(()=>js(`!document.querySelector('[data-history-id="11111111-one"]')`));
 await click('[data-filter="all"]');await until(()=>js(`!!document.querySelector('[data-history-id="11111111-one"]')`));
 await click('[data-history-id="11111111-one"]');await click('[data-action="history-clean"]');await until(()=>js(`document.querySelector('#dialog').open`));await js(`document.querySelector('#history-clean-mode').value='purge'`);await click('[data-action="dialog-confirm"]');
 await until(()=>js(`document.querySelector('#dialog').open&&document.querySelector('#dialog-body').textContent.includes('确认删除 ·')`));assert.ok(fs.existsSync(tasks[0].markdown),'preview does not delete');
 win.showInactive();await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(350);
 fs.writeFileSync(path.join(data,'purge-preview.png'),(await win.webContents.capturePage()).toPNG());await click('[data-action="dialog-confirm"]');await until(async()=>(await state()).tasks.length===1);assert.ok(fs.existsSync(tasks[0].source));assert.ok(!fs.existsSync(tasks[0].outputDir));
 await until(()=>js(`!!document.querySelector('[data-history-id="22222222-two"]')`));await click('[data-history-id="22222222-two"]');await click('[data-action="history-clean"]');await until(()=>js(`document.querySelector('#dialog').open`));await js(`document.querySelector('#history-clean-mode').value='purge';document.querySelector('[data-history-source]').checked=true`);await click('[data-action="dialog-confirm"]');await until(()=>js(`document.querySelector('#dialog').open&&document.querySelector('#dialog-body').textContent.includes('确认删除 ·')`));await click('[data-action="dialog-confirm"]');await until(()=>js(`!!document.querySelector('#dialog-input')&&document.querySelector('#dialog').open`));assert.ok(fs.existsSync(tasks[1].source),'original survives until typed confirmation');await js(`document.querySelector('#dialog-input').value='删除原始PDF'`);await click('[data-action="dialog-confirm"]');await until(async()=>(await state()).tasks.length===0);assert.ok(!fs.existsSync(tasks[1].source));assert.equal((await state()).taskCleanupHistory.length,2);assert.deepEqual(await js('window.__errors'),[]);
 console.log('PASS: real UI hide/query/restore, original default unchecked, resource preview, purge keeps original, separate typed original deletion, audit records');console.log('EVIDENCE '+data);
}).then(()=>{server?.kill();win?.destroy();app.exit(0);}).catch(e=>{console.error(e);server?.kill();win?.destroy();app.exit(1);});
