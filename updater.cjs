const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPO = 'chengyingzh433-stack/mineru-desk';
const RELEASES = `https://github.com/${REPO}/releases`;
function version(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || '');
  if (!match) throw Error('发布版本号无效');
  return match.slice(1).map(Number);
}
function newer(candidate, current) {
  const a = version(candidate), b = version(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function releaseInfo(release, current) {
  version(release.tag_name);
  if (release.draft || release.prerelease) throw Error('只接受正式发布版本');
  const v = release.tag_name.replace(/^v/, '');
  const filename = `MinerU-Desk-Setup-${v}-x64.exe`;
  const asset = release.assets?.find(a => a.name === filename);
  const sums = release.assets?.find(a => a.name === 'SHA256SUMS.txt');
  const prefix = `${RELEASES}/download/${release.tag_name}/`;
  if (!asset || !sums || asset.browser_download_url !== prefix + filename || sums.browser_download_url !== prefix + 'SHA256SUMS.txt') throw Error('发布页缺少安装程序或校验文件，请到项目下载页查看');
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 2 * 1024 ** 3) throw Error('安装程序大小异常');
  return { version:v, available:newer(v,current), filename, bytes:asset.size, url:asset.browser_download_url, sums:sums.browser_download_url, releaseUrl:`${RELEASES}/tag/${release.tag_name}` };
}
function checksum(text, filename) {
  const lines = text.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())).filter(Boolean).filter(m => m[2] === filename);
  if (lines.length !== 1) throw Error('SHA-256 校验清单缺失或重复');
  return lines[0][1].toLowerCase();
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function allowedDownload(url) {
  const u = new URL(url);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && (
    (u.hostname === 'github.com' && u.pathname.startsWith(`/${REPO}/releases/download/`)) ||
    ['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname));
}
async function request(url, { signal, api=false }={}) {
  for (let i=0;i<6;i++) {
    if (!(api && url === `https://api.github.com/repos/${REPO}/releases/latest`) && !allowedDownload(url)) throw Error('拒绝非项目发布地址');
    const response=await fetch(url,{signal,redirect:'manual',headers:{'User-Agent':'MinerU-Desk-Updater','Accept':api?'application/vnd.github+json':'application/octet-stream'}});
    if ([301,302,303,307,308].includes(response.status)) { const next=response.headers.get('location'); await response.body?.cancel(); if(!next)throw Error('下载重定向无效');url=new URL(next,url).href;api=false;continue; }
    if(!response.ok) { await response.body?.cancel();throw Error(`GitHub 返回 ${response.status}，请检查网络或稍后再试`); }
    return response;
  }
  throw Error('下载重定向次数过多');
}
async function readSmall(response, limit) {
  const parts=[];let bytes=0;
  for await(const part of response.body){bytes+=part.length;if(bytes>limit)throw Error('发布信息过大');parts.push(Buffer.from(part));}
  return Buffer.concat(parts).toString('utf8');
}
function createUpdater({ current, directory, fetchRelease, downloadRequest=request }) {
  let info=null, controller=null, downloaded=null;
  let state={status:'idle',current,message:'点击检查更新，不会自动联网下载。'};
  const snapshot=()=>({...state,release:info});
  return {
    snapshot,
    cancel(){controller?.abort();},
    async check(){
      if(['checking','downloading'].includes(state.status))throw Error('请等待当前检查或下载完成');
      state={status:'checking',current,message:'正在检查 GitHub 正式发布…'};
      try {
        const release=fetchRelease?await fetchRelease():JSON.parse(await readSmall(await request(`https://api.github.com/repos/${REPO}/releases/latest`,{api:true,signal:AbortSignal.timeout(20000)}),1024*1024));
        info=releaseInfo(release,current);downloaded=null;
        state={status:info.available?'available':'current',current,message:info.available?`可更新到 ${info.version}`:'已是当前正式版本。'};
      }catch(e){state={status:'error',current,message:e.message};throw e;}
      return snapshot();
    },
    async download(){
      if(!info?.available||state.status==='downloading')throw Error('请先检查可用更新');
      controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60*60*1000)]);
      state={status:'downloading',current,received:0,total:info.bytes,message:'正在下载安装程序…'};
      let job;
      try {
        const parent=await directory();fs.mkdirSync(parent,{recursive:true});
        const disk=fs.statfsSync(parent);if(disk.bavail*disk.bsize<info.bytes+128*1024**2)throw Error('缓存磁盘空间不足，请更换缓存目录');
        const expected=checksum(await readSmall(await downloadRequest(info.sums,{signal}),64*1024),info.filename);
        job=fs.mkdtempSync(path.join(parent,'download-'));const partial=path.join(job,info.filename+'.part');
        const response=await downloadRequest(info.url,{signal});
        const length=Number(response.headers.get('content-length'));if(length&&length!==info.bytes)throw Error('下载文件大小与发布信息不一致');
        const hash=crypto.createHash('sha256');let received=0;
        const meter=new Transform({transform(chunk,_encoding,callback){received+=chunk.length;if(received>info.bytes)return callback(Error('下载文件超出预期大小'));hash.update(chunk);state={...state,received};callback(null,chunk);}});
        await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(partial,{flags:'wx'}),{signal});
        if(received!==info.bytes||hash.digest('hex')!==expected)throw Error('下载校验失败，已取消更新，请重试');
        const file=path.join(job,info.filename);fs.renameSync(partial,file);downloaded={file,sha256:expected,version:info.version};
        state={...state,status:'ready',message:'下载完成，SHA-256 校验通过。安装前会再次确认。'};
      }catch(e){if(job){for(const name of [info.filename+'.part',info.filename])fs.rmSync(path.join(job,name),{force:true});fs.rmdirSync(job);}state={status:'error',current,message:controller.signal.aborted?'下载已取消，临时文件已清理。':e.message};throw Error(state.message);}
      finally{controller=null;}
      return snapshot();
    },
    async verifiedInstaller(){if(!downloaded||state.status!=='ready')throw Error('请先下载更新');if(await hashFile(downloaded.file)!==downloaded.sha256)throw Error('安装文件已变化，请重新下载');return {...downloaded};},
  };
}
module.exports={REPO,RELEASES,newer,releaseInfo,checksum,hashFile,allowedDownload,createUpdater};
