import fs from 'node:fs';
import path from 'node:path';
import {dataRoot} from './core.mjs';
const [command='status',...args]=process.argv.slice(2);
if(command==='help'){console.log('MinerU Desk agent interface\n  node cli.mjs status\n  node cli.mjs submit request.json\n  node cli.mjs task <id>\n  node cli.mjs content <id>\n  node cli.mjs retry <id>\n  node cli.mjs cancel <id>\n  node cli.mjs resume\n  node cli.mjs models\n  node cli.mjs edit <id> request.json\nSubmit JSON: {files:[absolute paths],outputRoot:absolute path,options:{provider:"local",backend:"pipeline"}}\nStart the desktop app or npm run service first.');process.exit(0);}
try{
 const info=JSON.parse(fs.readFileSync(path.join(dataRoot,'connection.json'),'utf8'));
 let route,body,method='GET';
 if(command==='status')route='state';
 else if(command==='request'){method=args[0].toUpperCase();route=args[1];if(!['GET','POST'].includes(method))throw Error('只支持 GET / POST');if(method==='POST')body=args[2]?JSON.parse(fs.readFileSync(args[2],'utf8')):{};}
 else if(command==='models')route='models';
 else if(command==='submit'){route='tasks';method='POST';body={...JSON.parse(fs.readFileSync(args[0],'utf8')),origin:'codex'};}
 else if(command==='resume'){route='queue';method='POST';body={paused:false,resumeInterrupted:true};}
 else if(['task','content','retry','cancel','edit'].includes(command)){route='tasks/'+args[0]+(command==='task'?'':'/'+command);if(['retry','cancel','edit'].includes(command)){method='POST';body=command==='edit'?JSON.parse(fs.readFileSync(args[1],'utf8')):{};}}
 else throw Error('未知命令；运行 node cli.mjs help');
 const res=await fetch(`http://127.0.0.1:${info.port}/api/${route}`,{method,headers:{Authorization:'Bearer '+info.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await res.json();if(!res.ok)throw Error(result.error);console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.code==='ENOENT'?'请先打开 MinerU Desk，或运行 npm run service。':e.message);process.exitCode=1;}
