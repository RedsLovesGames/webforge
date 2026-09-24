import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export function providerError(error, source){
  if(error?.code && ['auth_required','rate_limited','unavailable','invalid_payload','unsupported'].includes(error.code)) return error;
  const e=new Error(error?.message||String(error)); e.code='unavailable'; e.source=source?.id; return e;
}

async function resolveExecutableImpl(executable){
  if(!executable) return null;
  if(path.isAbsolute(executable)){ try{ await access(executable,constants.X_OK); return executable; }catch{return null;} }
  const exts=process.platform==='win32'?(process.env.PATHEXT||'.EXE;.CMD;.BAT;.COM').split(';'):[''];
  for(const dir of String(process.env.PATH||'').split(path.delimiter).filter(Boolean)) for(const ext of exts){ const candidate=path.join(dir,process.platform==='win32'&&ext&&!executable.toLowerCase().endsWith(ext.toLowerCase())?executable+ext:executable); try{ await access(candidate,constants.X_OK); return candidate; }catch{} }
  return null;
}
async function commandExistsImpl(executable){return Boolean(await resolveExecutableImpl(executable));}

export function prepareSpawnTarget(resolved,args=[],options={}){
  const platform=options.platform||process.platform,nodeExec=options.nodeExec||process.execPath;
  if(platform!=='win32'||!/\.(?:cmd|bat)$/i.test(resolved)) return {executable:resolved,args};
  const base=path.win32.basename(resolved).toLowerCase();
  if(base==='npm.cmd'||base==='npx.cmd'){
    const cli=base==='npm.cmd'?'npm-cli.js':'npx-cli.js';
    return {executable:nodeExec,args:[path.win32.join(path.win32.dirname(resolved),'node_modules','npm','bin',cli),...args]};
  }
  const e=new Error(`unsupported Windows command script without safe launcher: ${resolved}`);e.code='unsupported';throw e;
}

async function spawnCommandImpl(executable,args=[],options={}){
  const resolved=await resolveExecutableImpl(executable); if(!resolved){const e=new Error(`executable not found: ${executable}`);e.code='unavailable';throw e;}
  const target=prepareSpawnTarget(resolved,args);
  return await new Promise((resolve,reject)=>{
    const child=spawn(target.executable,target.args,{cwd:options.cwd,env:options.env||process.env,stdio:options.stdio||'inherit',shell:false});
    child.once('error',err=>{err.code=err.code==='ENOENT'?'unavailable':err.code; reject(err);}); child.once('close',status=>resolve({status}));
  });
}

async function spawnCaptureImpl(executable,args=[],options={}){
  const resolved=await resolveExecutableImpl(executable); if(!resolved){const e=new Error(`executable not found: ${executable}`);e.code='unavailable';throw e;}
  const target=prepareSpawnTarget(resolved,args);
  return await new Promise((resolve,reject)=>{
    const child=spawn(target.executable,target.args,{cwd:options.cwd,env:options.env||process.env,stdio:['ignore','pipe','pipe'],shell:false});
    let stdout='',stderr=''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data',c=>stdout+=c); child.stderr.on('data',c=>stderr+=c);
    child.once('error',err=>{err.code=err.code==='ENOENT'?'unavailable':err.code; reject(err);}); child.once('close',status=>resolve({status,stdout,stderr}));
  });
}

const hashUrl=url=>createHash('sha256').update(String(url)).digest('hex').slice(0,24);
async function readJsonMaybe(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}

export function createProviderContext(root=process.cwd(),overrides={}){
  root=path.resolve(root);
  const cacheRoot=path.join(root,'.webforge','cache','providers');
  const fetchText=overrides.fetchText||(async(url,opts={})=>{
    const sourceId=String(opts.sourceId||'_http').replace(/[^a-z0-9._-]/gi,'-'),dir=path.join(cacheRoot,sourceId),key=hashUrl(url),metaFile=path.join(dir,`${key}.json`),bodyFile=path.join(dir,`${key}.body`);
    const prior=await readJsonMaybe(metaFile); const headers={'user-agent':'WebForge/0.2.0 (+https://github.com/RedsLovesGames/webforge)',...(opts.headers||{})};
    if(prior?.etag)headers['if-none-match']=prior.etag;if(prior?.lastModified)headers['if-modified-since']=prior.lastModified;
    let r;try{r=await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(opts.timeoutMs||15000)});}catch(e){e.code=e.code||'unavailable';throw e;}
    if(r.status===304&&prior){return {text:await readFile(bodyFile,'utf8'),contentType:prior.contentType||'',finalUrl:prior.finalUrl||url,etag:prior.etag||null,lastModified:prior.lastModified||null,cached:true};}
    if(r.status===401||r.status===403){const e=new Error(`HTTP ${r.status}`);e.code='auth_required';throw e;}
    if(r.status===429){const e=new Error('HTTP 429 rate limited');e.code='rate_limited';e.retryAfter=r.headers.get('retry-after');throw e;}
    if(!r.ok){const e=new Error(`HTTP ${r.status} ${r.statusText}`);e.code='unavailable';throw e;}
    const text=await r.text(),meta={url,finalUrl:r.url,contentType:r.headers.get('content-type')||'',etag:r.headers.get('etag'),lastModified:r.headers.get('last-modified'),fetchedAt:new Date().toISOString()};
    await mkdir(dir,{recursive:true});await writeFile(bodyFile,text);await writeFile(metaFile,JSON.stringify(meta,null,2)+'\n');return {text,...meta,cached:false};
  });
  const fetchJson=overrides.fetchJson||(async(url,opts={})=>{const r=await fetchText(url,opts);try{return {data:JSON.parse(r.text),...r};}catch(e){e.code='invalid_payload';throw e;}});
  const writeSnapshot=overrides.writeSnapshot||(async(sourceId,items)=>{
    const dir=path.join(root,'registry','sources'); await mkdir(dir,{recursive:true});
    const dest=path.join(dir,`${sourceId.replace(/[^a-z0-9._-]+/gi,'-')}.jsonl`),tmp=`${dest}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp,items.map(x=>JSON.stringify(x)).join('\n')+(items.length?'\n':'')); await rename(tmp,dest); return {path:dest,count:items.length};
  });
  return {root,cacheRoot,fetchText,fetchJson,writeSnapshot,spawnCommand:overrides.spawnCommand||spawnCommandImpl,spawnCapture:overrides.spawnCapture||spawnCaptureImpl,commandExists:overrides.commandExists||commandExistsImpl,resolveExecutable:overrides.resolveExecutable||resolveExecutableImpl,...overrides};
}
