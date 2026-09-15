import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(process.argv[2]);
if(!fs.existsSync(path.join(root,'mineru-desk-bundle.json')))throw Error('Expected MinerU distribution marker');
const forbidden=new Set(['data','models','cache','output','test-output']);
const files=[];
async function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Unexpected symlink');if(entry.name==='__pycache__'||/\.py[co]$/.test(entry.name))continue;const p=path.join(dir,entry.name),relative=path.relative(root,p);if(dir===root&&forbidden.has(entry.name))continue;if(entry.isDirectory())await visit(p);else{if(entry.name==='file-manifest.json')continue;if(['state.json','connection.json','cloud-token.dat'].includes(entry.name))throw Error('Private state in static payload: '+relative);const hash=crypto.createHash('sha256');for await(const c of fs.createReadStream(p))hash.update(c);files.push({path:relative.replaceAll('\\','/'),bytes:fs.statSync(p).size,sha256:hash.digest('hex')});}}}
await visit(root);files.sort((a,b)=>a.path.localeCompare(b.path));fs.writeFileSync(path.join(root,'file-manifest.json'),JSON.stringify({schema:1,files},null,2));console.log(JSON.stringify({root,files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0)}));
