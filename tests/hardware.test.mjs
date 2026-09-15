import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recommend} from '../hardware.mjs';
const base={ramGB:28,platform:'win32',python:'3.12.10',disks:[]};
test('AMD / CPU environment does not get an invented CUDA or dedicated VRAM recommendation',()=>{const r=recommend({...base,torch:{cudaAvailable:false}});assert.equal(r.backend,'pipeline');assert.match(r.warnings.join(),/32 GB/);});
test('engine requires verified CUDA, sufficient per-device VRAM and architecture',()=>{assert.equal(recommend({...base,torch:{cudaAvailable:true,devices:[{vramGB:8,capability:8.6}]}}).backend,'hybrid-engine');for(const devices of [[{vramGB:4,capability:8.6}],[{vramGB:24,capability:6.1}],[{vramGB:4,capability:8.6},{vramGB:4,capability:8.6}]])assert.equal(recommend({...base,torch:{cudaAvailable:true,devices}}).backend,'pipeline');});
test('unknown detection is not asserted unsupported; low RAM and Windows Python footnote explained',()=>{assert.match(recommend(base).reasons.join(),/尚未确认/);assert.equal(recommend({...base,ramGB:8}).provider,'cloud');assert.match(recommend({...base,python:'3.13.0'}).warnings.join(),/3.10–3.12/);});
