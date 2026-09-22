import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import lifecycleModule from '../window-lifecycle.cjs';
const {createWindowLifecycle,loadPreferences}=lifecycleModule;
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mineru-tray-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const win=new EventEmitter();Object.assign(win,{visible:true,minimized:false,enabled:true,skip:false,isDestroyed:()=>false,isMinimized:()=>win.minimized,restore:()=>win.minimized=false,show:()=>win.visible=true,hide:()=>win.visible=false,focus:()=>{},setSkipTaskbar:v=>win.skip=v,setEnabled:v=>win.enabled=v});
 const app=new EventEmitter();app.quit=()=>{const event={preventDefault(){this.prevented=true;}};app.emit('before-quit',event);if(!event.prevented){app.quits=(app.quits||0)+1;app.emit('will-quit');}};
 class Tray extends EventEmitter {destroy(){this.dead=true;}isDestroyed(){return !!this.dead;}setToolTip(){}setContextMenu(menu){this.menu=menu;}displayBalloon(){}}
 const answers=[],questions=[],state={busy:false,dirty:false,stops:0,maintaining:false,fail:false};
 const preferencesFile=path.join(dir,'window-preferences.json');
 const controller=createWindowLifecycle({app,win,Tray,Menu:{buildFromTemplate:x=>x},dialog:{showMessageBox:async(_win,options)=>{questions.push(options);return answers.shift()||{response:0,checkboxChecked:false};}},icon:'synthetic.ico',preferencesFile,hasUnsaved:async()=>state.dirty,isBusy:async()=>state.busy,isMaintaining:()=>state.maintaining,stopBackend:async()=>{if(state.fail)throw Error('busy race');state.stops++;}});
 return {win,app,answers,questions,state,controller,preferencesFile};
}
test('close offers a choice; hide preserves unsaved content; tray click restores',async t=>{
 const x=setup(t);x.state.dirty=true;x.answers.push({response:0,checkboxChecked:true});assert.equal(await x.controller.close(),true);
 assert.equal(x.win.visible,false);assert.equal(x.state.stops,0);assert.equal(x.app.quits,undefined);
 assert.equal(loadPreferences(x.preferencesFile).closeAction,'tray');x.controller.tray.emit('click');assert.equal(x.win.visible,true);assert.equal(x.win.skip,false);
 await x.controller.close();assert.equal(x.questions.length,1);assert.equal(x.win.visible,false);
});
test('cancel keeps window; minimize uses tray; settings can keep taskbar',async t=>{
 const x=setup(t);x.answers.push({response:2});await x.controller.close();assert.equal(x.win.visible,true);
 x.win.emit('minimize',{preventDefault(){}});assert.equal(x.win.visible,false);x.controller.show();
 x.answers.push({response:0,checkboxChecked:false});await x.controller.configure();x.win.emit('minimize',{preventDefault(){}});assert.equal(x.win.visible,true);assert.equal(loadPreferences(x.preferencesFile).minimizeToTray,false);
});
test('busy work blocks exit and can continue in tray',async t=>{
 const x=setup(t);x.state.busy=true;await x.controller.requestQuit();assert.equal(x.state.stops,0);assert.equal(x.app.quits,undefined);assert.equal(x.win.visible,false);
});
test('unsaved edits cancel exit; explicit discard stops backend and destroys tray',async t=>{
 const x=setup(t);x.state.dirty=true;x.answers.push({response:0});await x.controller.requestQuit();assert.equal(x.state.stops,0);
 x.answers.push({response:1});await x.controller.requestQuit();assert.equal(x.state.stops,1);assert.equal(x.app.quits,1);assert.equal(x.controller.tray.isDestroyed(),true);assert.equal(x.controller.canUnload(),true);
});
test('shutdown failure restores enabled window; maintenance bypass does not stop twice',async t=>{
 const x=setup(t);x.state.fail=true;await x.controller.requestQuit();assert.equal(x.app.quits,undefined);assert.equal(x.win.enabled,true);
 x.state.maintaining=true;const event={preventDefault(){this.prevented=true;}};x.win.emit('close',event);assert.equal(event.prevented,undefined);x.app.quit();assert.equal(x.app.quits,1);assert.equal(x.state.stops,0);
});
test('app quit and titlebar close are intercepted; no concurrent dialogs',async t=>{
 const x=setup(t);x.answers.push({response:2});const event={preventDefault(){this.prevented=true;}};x.win.emit('close',event);assert.equal(event.prevented,true);
 await x.controller.close();assert.equal(x.questions.length,1);await new Promise(r=>setImmediate(r));
 x.app.quit();await new Promise(r=>setImmediate(r));assert.equal(x.app.quits,1);assert.equal(x.state.stops,1);
});
