import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {findExecutable,defaults,runProcess,digestFile} from '../core.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data=path.join(root,'test-output','real-'+Date.now());fs.mkdirSync(data,{recursive:true});
const mineru=findExecutable(defaults,'local');assert.ok(mineru,'Local MinerU is required');
const py=path.join(path.dirname(mineru),'python.exe');const fixture=path.join(data,'中文测试文档.docx');
await runProcess(py,['-c','from docx import Document; import sys; d=Document(); d.add_heading("MinerU Desktop Test",0); d.add_heading("Physics Education",1); d.add_paragraph("This is a synthetic document for local conversion verification."); t=d.add_table(rows=2, cols=2); t.cell(0,0).text="Method"; t.cell(0,1).text="Sample"; t.cell(1,0).text="Interview"; t.cell(1,1).text="12"; d.save(sys.argv[1])',fixture]);
await runProcess(py,['-c','from PIL import Image, ImageDraw; from docx import Document; from docx.shared import Inches; import sys; p=sys.argv[2]; im=Image.new("RGB",(400,220),"white"); draw=ImageDraw.Draw(im); draw.rectangle((20,20,170,180),fill=(60,130,100)); draw.ellipse((220,40,370,190),fill=(210,140,70)); im.save(p); d=Document(sys.argv[1]); d.add_paragraph("Figure 1. Synthetic image retention fixture."); d.add_picture(p,width=Inches(3)); d.save(sys.argv[1])',fixture,path.join(data,'figure.png')]);
const original=await digestFile(fixture);
const server=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,MINERU_DESK_DATA:data},windowsHide:true,stdio:['ignore','pipe','pipe']});
server.stderr.on('data',c=>process.stderr.write(c));
let connection;
for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));try{connection=JSON.parse(fs.readFileSync(path.join(data,'connection.json'),'utf8'));break;}catch{}}
assert.ok(connection);
async function api(route,body,allowError=false){const r=await fetch(`http://127.0.0.1:${connection.port}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!allowError)assert.ok(r.ok,JSON.stringify(value));return {value,status:r.status};}
async function finished(id){for(let i=0;i<240;i++){const {value:t}=await api('tasks/'+id);if(!['queued','running'].includes(t.status))return t;await new Promise(r=>setTimeout(r,1000));}throw Error('Conversion timeout');}
try{
 await api('settings',{mineru,outputRoot:path.join(data,'results'),workRoot:path.join(data,'selected-cache'),modelRoot:path.join(data,'selected-models')});
 const {value:[first]}=await api('tasks',{files:[fixture],origin:'codex',options:{provider:'local',backend:'pipeline',timeout:180}});
 let result=await finished(first.id);console.log('FIRST',result.status,result.log?.slice(-3000));assert.equal(result.status,'completed');assert.equal(original,await digestFile(fixture));
 const {value:c}=await api('tasks/'+first.id+'/content');assert.match(c.text,/Physics Education/);
 assert.match(c.text,/!\[.*?\]\(.+?\)/);assert.ok(c.files.some(f=>/\.(png|jpg|jpeg)$/i.test(f.name)),'Converted image files are preserved');
 assert.ok(!fs.existsSync(path.join(data,'selected-cache','tmp','convert-'+first.id)),'Successful converter temp dir is automatically cleaned');
 const {value:edited}=await api('tasks/'+first.id+'/edit',{text:c.text+'\n\nManually edited.\n',revision:c.revision});assert.ok(edited.edited);assert.match(edited.text,/Manually edited/);assert.doesNotMatch(edited.original,/Manually edited/);
 const conflict=await api('tasks/'+first.id+'/edit',{text:'stale',revision:c.revision},true);assert.equal(conflict.status,409);
 const {value:[second]}=await api('tasks',{files:[fixture],origin:'codex',options:{provider:'local',backend:'pipeline',timeout:180}});const secondResult=await finished(second.id);assert.equal(secondResult.status,'reused');
 const {value:[third]}=await api('tasks',{files:[fixture],origin:'codex',options:{provider:'local',backend:'pipeline',timeout:180}});assert.equal((await finished(third.id)).status,'reused');assert.match((await api('tasks/'+third.id+'/content')).value.text,/Manually edited/);
 await api('queue',{paused:true});const {value:[waiting]}=await api('tasks',{files:[fixture],options:{provider:'local'}});assert.equal((await api('tasks/'+waiting.id)).value.status,'queued');
 assert.equal((await fetch(`http://127.0.0.1:${connection.port}/api/state`)).status,401);
 const traversal=await fetch(`http://127.0.0.1:${connection.port}/api/tasks/${first.id}/file?path=..%2F..%2Fstate.json`,{headers:{Authorization:'Bearer '+connection.token}});assert.equal(traversal.status,400);
 console.log('PASS: actual local DOCX conversion with image references and image files, source preserved, redirected and auto-cleaned temps, two cache reuses, editor save, conflict guard, queue pause, API authentication, file containment');
 fs.writeFileSync(path.join(root,'test-output','real-smoke-result.json'),JSON.stringify({data,first:first.id,result:result.status,cache:secondResult.status,checks:'passed'},null,2));
}finally{server.kill();}
