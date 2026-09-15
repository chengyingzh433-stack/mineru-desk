const fs=require('node:fs');
const path=require('node:path');
let root=__dirname;
let bundleRoot=null;
for(let i=0;i<5;i++){
 if(fs.existsSync(path.join(root,'mineru-desk-bundle.json'))){bundleRoot=root;break;}
 const parent=path.dirname(root);if(parent===root)break;root=parent;
}
const metadata=bundleRoot?JSON.parse(fs.readFileSync(path.join(bundleRoot,'mineru-desk-bundle.json'),'utf8')):{};
const installed=metadata.distribution==='installer';
const workspaceRoot=bundleRoot?(installed?path.join(path.dirname(bundleRoot),'MinerU-Desk-Data'):bundleRoot):null;
module.exports={bundleRoot,workspaceRoot,installed};
