const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let info=null,loading=false;
export function mountMaintenance({page,provider}){
 const optionArea=document.querySelector('#options');
 if(optionArea&&provider==='cloud'&&!document.querySelector('#cloud-token-shortcut')){
  const section=document.createElement('div');section.id='cloud-token-shortcut';section.className='setting-section';
  section.innerHTML='<label class="field-label">官方 API Token</label><div class="model-actions"><button class="button soft" data-action="get-token">获取官方 Token ↗</button><button class="button" data-action="go-settings">填写 / 管理 Token</button></div><p class="hint">在 MinerU 官网登录并创建 Token，然后回到应用设置保存。</p>';
  optionArea.querySelector('.setting-section')?.after(section);
 }
 if(page!=='settings')return;
 let slot=document.querySelector('#app-maintenance');
 if(!slot){slot=document.createElement('section');slot.id='app-maintenance';slot.className='panel panel-body';document.querySelector('#main').append(slot);}
 render(slot);
 if(!loading&&window.deskSystem){loading=true;window.deskSystem.info().then(value=>{info=value;const current=document.querySelector('#app-maintenance');if(current)render(current);}).catch(e=>{slot.textContent='版本信息读取失败：'+e.message;}).finally(()=>loading=false);}
}
function render(slot){
 const update=info?.update||{};const busy=['checking','downloading'].includes(update.status);
 const percent=update.total?Math.min(100,Math.floor(update.received/update.total*100)):0;
 slot.innerHTML=`<div class="toolbar"><h2>版本与维护</h2><span class="badge">v${escape(info?.version||'0.3.3')}</span></div>
 <p class="hint">更新会覆盖安装到原位置，无需先卸载。模型、论文、结果和设置保留。</p>
 <p role="status">${escape(update.message||'仅在点击检查更新时连接 GitHub。')}</p>
 ${update.release?.available?`<p>新版本 ${escape(update.release.version)} · 安装包 ${(update.release.bytes/1024**2).toFixed(1)} MB</p>`:''}
 ${update.status==='downloading'?`<progress max="100" value="${percent}" style="width:100%"></progress><p>${percent}% · ${((update.received||0)/1024**2).toFixed(1)} / ${(update.total/1024**2).toFixed(1)} MB</p>`:''}
 <div class="model-actions"><button class="button soft" data-maintenance="check" ${busy?'disabled':''}>检查更新</button>
 ${info?.installed&&update.release?.available&&!['ready','downloading','checking'].includes(update.status)?'<button class="button primary" data-maintenance="download">下载更新</button>':''}
 ${update.status==='downloading'?'<button class="button" data-maintenance="cancel">取消下载</button>':''}
 ${update.status==='ready'?'<button class="button primary" data-maintenance="install">安装更新并重启</button>':''}
 <button class="button" data-action="release-page">打开项目下载页 ↗</button></div>
 <p class="hint">下载使用设置中的缓存目录。安装程序经过 SHA-256 校验，尚未做代码签名。GitHub 无法连接时，可手动下载同版本安装包覆盖安装。</p>
 <hr><h3>窗口与托盘</h3><p class="hint">关闭窗口：${escape({ask:'每次询问',tray:'最小化到托盘',quit:'退出程序'}[info?.window?.closeAction]||'每次询问')}。最小化按钮：${info?.window?.minimizeToTray===false?'收起到任务栏':'收起到右下角托盘'}。</p>
 <button class="button" data-maintenance="configure">设置关闭 / 最小化行为…</button>
 <p class="hint">点击托盘图标恢复窗口，右键可退出。图标可能在右下角“^”里。最小化会保留未保存内容并继续任务；退出前会检查未保存内容及正在运行的任务。</p>
 <hr><h3>卸载程序</h3><p class="hint">卸载本桌面程序和随包 MinerU、Python、CPU 依赖；保留外部模型、论文、结果和任务记录，不删除另外安装的 MinerU。</p>
 <button class="button danger" data-maintenance="uninstall" ${!info?.installed||busy?'disabled':''}>卸载 MinerU 与桌面程序…</button>
 ${!info?.installed?'<p class="hint">源码 / 便携运行模式不提供自动安装和卸载；请使用 Windows 安装版。</p>':''}`;
}
export async function maintenanceAction(action){
 if(!window.deskSystem)throw Error('请在桌面客户端中使用此功能');
 if(!['check','download','cancel','install','uninstall','configure'].includes(action))return;
 if(action!=='configure'&&window.__mineruUnsaved?.())throw Error('请先保存或放弃正在编辑的内容和设置');
 try{return await window.deskSystem[action]();}finally{info=await window.deskSystem.info();const slot=document.querySelector('#app-maintenance');if(slot)render(slot);}
}
