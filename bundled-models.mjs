import fs from 'node:fs';
import path from 'node:path';
// Configure only a new workspace. Never replace a user's import or re-add a
// model deliberately deleted through the UI (which retains the config file).
export function initializeBundledModels({bundleRoot,workspaceRoot,dataRoot}){
 if(!bundleRoot||!workspaceRoot)return false;
 const marker=JSON.parse(fs.readFileSync(path.join(bundleRoot,'mineru-desk-bundle.json'),'utf8'));
 if(marker.distribution!=='installer'||!marker.modelsIncluded)return false;
 const config=path.join(dataRoot,'mineru.json');if(fs.existsSync(config))return false;
 const model=path.join(workspaceRoot,'models','pipeline-bundled-0.3.1');
 if(!fs.existsSync(path.join(model,'models','Layout','PP-DocLayoutV2','model.safetensors')))return false;
 fs.mkdirSync(dataRoot,{recursive:true});
 fs.writeFileSync(config,JSON.stringify({'models-dir':{pipeline:model,vlm:''},'config_version':'1.3.2'},null,2),{flag:'wx'});
 fs.writeFileSync(path.join(dataRoot,'owned-models.json'),JSON.stringify([model]),{flag:'wx'});
 return true;
}
