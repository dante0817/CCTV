import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=path.join(root,'tools','ai');
const target=path.join(dir,'tiny-yolov3-11.onnx');
const expected='f715cc2d99740d22d312777e20d9de2b2ecdc250155be8fd3752ce7e8b823521';
const url='https://huggingface.co/onnxmodelzoo/tiny-yolov3-11/resolve/main/tiny-yolov3-11.onnx?download=true';
await fsp.mkdir(dir,{recursive:true});
function hashFile(file){return new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');const s=fs.createReadStream(file);s.on('data',c=>h.update(c));s.on('error',reject);s.on('end',()=>resolve(h.digest('hex')));});}
if(fs.existsSync(target)){const h=await hashFile(target);if(h===expected){console.log('[OK] AI model already installed and verified.');process.exit(0);}console.warn('[WARN] Existing AI model hash does not match; replacing it.');await fsp.rm(target,{force:true});}
console.log('[INFO] Downloading local AI model (Tiny YOLOv3 ONNX, about 35.5 MB)...');
const response=await fetch(url,{redirect:'follow'});if(!response.ok||!response.body)throw new Error(`AI model download failed: HTTP ${response.status}`);
const temp=target+'.download';const file=fs.createWriteStream(temp);for await(const chunk of response.body)file.write(chunk);await new Promise((resolve,reject)=>{file.end(resolve);file.on('error',reject);});
const h=await hashFile(temp);if(h!==expected){await fsp.rm(temp,{force:true});throw new Error(`AI model SHA-256 mismatch. Expected ${expected}; got ${h}`);}
await fsp.rename(temp,target);console.log('[OK] AI model installed and SHA-256 verified.');
