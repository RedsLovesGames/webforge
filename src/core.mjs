import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_SOURCES } from './catalog.mjs';

export const VERSION = '0.1.0';
const SOURCE_FILE = 'sources.json';
const STATE_DIR = '.webforge';
const REGISTRY_DIR = path.join('registry', 'sources');

const uniq = values => [...new Set((Array.isArray(values) ? values : []).map(String).map(x => x.trim()).filter(Boolean))];
const cleanType = (value='component') => String(value).replace(/^registry:/,'').replace(/^ui:/,'') || 'component';
const slugify = input => String(input || '').toLowerCase().replace(/^https?:\/\//,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'source';
const sourcePath = root => path.join(root, SOURCE_FILE);
const registryPath = root => path.join(root, REGISTRY_DIR);
const dbPath = root => path.join(root, STATE_DIR, 'index.sqlite');

async function jsonRead(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}
async function jsonWrite(file, value) { await mkdir(path.dirname(file), { recursive:true }); await writeFile(file, JSON.stringify(value,null,2)+'\n'); }
function stripHtml(value='') { return String(value).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim(); }
function htmlMeta(html, name) {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for (const pattern of [new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,'i'),new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,'i')]) { const m=html.match(pattern); if(m) return stripHtml(m[1]); }
  return '';
}
function htmlTitle(html,fallback='') { return htmlMeta(html,'og:title') || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || fallback; }
function htmlDescription(html) { return htmlMeta(html,'description') || htmlMeta(html,'og:description') || ''; }

export function tokenizeSearch(query) {
  const blocked=new Set(['and','or','not','near']);
  return String(query||'').toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g)?.filter(x=>!blocked.has(x)).join(' ') || '';
}

function openDb(root) {
  const db=new DatabaseSync(dbPath(root));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,type TEXT NOT NULL,source_id TEXT NOT NULL,tags TEXT NOT NULL,json TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS asset_fts USING fts5(id UNINDEXED,title,description,tags,source,type,tokenize='porter unicode61');`);
  return db;
}

export async function initWorkspace(root=process.cwd(), options={}) {
  root=path.resolve(root); await mkdir(path.join(root,STATE_DIR),{recursive:true}); await mkdir(registryPath(root),{recursive:true});
  if(!existsSync(sourcePath(root))) await jsonWrite(sourcePath(root), options.seedSources===false ? [] : DEFAULT_SOURCES);
  const db=openDb(root); db.close(); return { root, sources:(await listSources(root)).length };
}

async function walkJsonl(dir) {
  const out=[]; if(!existsSync(dir)) return out;
  for(const entry of await readdir(dir,{withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) out.push(...await walkJsonl(file)); else if(entry.isFile()&&entry.name.endsWith('.jsonl')) out.push(file); }
  return out;
}
async function readRows(root) {
  const rows=[]; for(const file of await walkJsonl(registryPath(root))) { const text=await readFile(file,'utf8'); for(const [i,line] of text.split(/\r?\n/).entries()) { if(!line.trim()) continue; try{rows.push(JSON.parse(line));}catch(e){rows.push({__parseError:`${file}:${i+1}: ${e.message}`});} } } return rows;
}

export async function rebuildIndex(root=process.cwd()) {
  root=path.resolve(root); await initWorkspace(root,{seedSources:false}); const rows=await readRows(root); const db=openDb(root);
  db.exec('BEGIN; DELETE FROM asset_fts; DELETE FROM assets;');
  const a=db.prepare('INSERT OR REPLACE INTO assets(id,title,description,type,source_id,tags,json) VALUES(?,?,?,?,?,?,?)');
  const f=db.prepare('INSERT INTO asset_fts(id,title,description,tags,source,type) VALUES(?,?,?,?,?,?)'); let indexed=0;
  try { for(const item of rows) { if(!item?.id||item.__parseError) continue; const title=String(item.title||item.name||item.id), description=String(item.description||''), type=cleanType(item.type), source=String(item.source?.id||'unknown'), tags=uniq(item.tags).join(' '), json=JSON.stringify(item); a.run(item.id,title,description,type,source,tags,json); f.run(item.id,title,description,tags,source,type); indexed++; } db.exec('COMMIT;'); }
  catch(e){db.exec('ROLLBACK;');throw e;} finally{db.close();}
  return { indexed, files:(await walkJsonl(registryPath(root))).length };
}
function ftsQuery(q){return tokenizeSearch(q).split(' ').filter(Boolean).map(x=>`"${x.replaceAll('"','""')}"*`).join(' AND ');}
export function searchAssets(root=process.cwd(),query='',options={}) {
  const db=openDb(path.resolve(root)); const limit=Math.max(1,Math.min(Number(options.limit||5),100));
  try { const filters=[],params=[]; if(options.type){filters.push('a.type=?');params.push(options.type);} if(options.source){filters.push('a.source_id=?');params.push(options.source);} const q=ftsQuery(query); let rows;
    if(q) rows=db.prepare(`SELECT a.json,bm25(asset_fts) score FROM asset_fts JOIN assets a ON a.id=asset_fts.id WHERE asset_fts MATCH ?${filters.length?' AND '+filters.join(' AND '):''} ORDER BY score,a.title LIMIT ?`).all(q,...params,limit);
    else rows=db.prepare(`SELECT a.json,0 score FROM assets a ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY a.title LIMIT ?`).all(...params,limit);
    return rows.map(r=>({...JSON.parse(r.json),_score:r.score}));
  } finally{db.close();}
}
export function getAsset(root=process.cwd(),id){const db=openDb(path.resolve(root));try{const row=db.prepare('SELECT json FROM assets WHERE id=?').get(String(id));return row?JSON.parse(row.json):null;}finally{db.close();}}

export async function listSources(root=process.cwd()) { const value=await jsonRead(sourcePath(path.resolve(root)),[]); if(!Array.isArray(value)) throw new Error(`${SOURCE_FILE} must contain a JSON array`); return value; }
export async function addSource(root=process.cwd(),input={}) {
  root=path.resolve(root); await initWorkspace(root,{seedSources:false}); if(!input.url) throw new Error('source url is required'); const url=new URL(input.url).toString(); const id=slugify(input.id||new URL(url).hostname.replace(/^www\./,'')); const sources=await listSources(root); if(sources.some(x=>x.id===id)) throw new Error(`source already exists: ${id}`);
  const source={id,name:input.name||id,url,manifestUrl:input.manifestUrl||null,adapter:input.adapter||'auto',enabled:input.enabled!==false,allowCodeIngest:Boolean(input.allowCodeIngest),tags:uniq(input.tags),license:input.license||null}; sources.push(source); await jsonWrite(sourcePath(root),sources); return source;
}
async function fetchText(url,timeoutMs=15000){const r=await fetch(url,{headers:{'user-agent':`WebForge/${VERSION} (+https://github.com/RedsLovesGames/webforge)`},redirect:'follow',signal:AbortSignal.timeout(timeoutMs)});if(!r.ok)throw new Error(`HTTP ${r.status} ${r.statusText}`);return{text:await r.text(),contentType:r.headers.get('content-type')||'',finalUrl:r.url};}
function inferTags(item,source){const words=tokenizeSearch(`${item.name||''} ${item.title||''} ${item.description||''}`).split(' ').filter(x=>x.length>=3).slice(0,20);return uniq([...(item.tags||[]),...(source.tags||[]),...words]).slice(0,40);}

export function normalizeRegistryPayload(payload,source) {
  const raw=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:payload?.name&&(payload.files||payload.type)?[payload]:null; if(!raw) throw new Error('JSON is not a recognized registry or registry item payload');
  return raw.map((item,i)=>{const name=slugify(item.name||item.title||`item-${i+1}`),lv=item.license||source.license||null,license=typeof lv==='string'?{id:lv}:lv||null; const files=(Array.isArray(item.files)?item.files:[]).map(file=>({path:file.path||file.target||file.name||'',target:file.target||null,type:file.type||null,url:file.url||null,...(source.allowCodeIngest&&typeof file.content==='string'?{content:file.content}:{})})).filter(f=>f.path);
    return{id:`${source.id}/${name}`,name,title:String(item.title||item.name||name),description:String(item.description||''),type:cleanType(item.type||'component'),source:{id:source.id,name:source.name||source.id,url:source.url},tags:inferTags(item,source),dependencies:uniq(item.dependencies),devDependencies:uniq(item.devDependencies),registryDependencies:uniq(item.registryDependencies),files,cssVars:item.cssVars||null,css:item.css||null,meta:item.meta||null,license,ingest:{codeIncluded:Boolean(source.allowCodeIngest),adapter:source.adapter||'auto'}};
  });
}
function normalizeReference(html,source,finalUrl=source.url){const title=htmlTitle(html,source.name||source.id),description=htmlDescription(html);return[{id:`${source.id}/__source__`,name:source.id,title,description,type:'reference',source:{id:source.id,name:source.name||source.id,url:finalUrl},tags:uniq([...(source.tags||[]),...tokenizeSearch(`${title} ${description}`).split(' ').filter(x=>x.length>=3).slice(0,20)]),dependencies:[],registryDependencies:[],files:[],license:source.license?(typeof source.license==='string'?{id:source.license}:source.license):null,ingest:{codeIncluded:false,adapter:source.adapter||'reference'}}];}
async function writeSource(root,id,items){const file=path.join(registryPath(root),`${slugify(id)}.jsonl`);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,items.map(x=>JSON.stringify(x)).join('\n')+(items.length?'\n':''));return file;}
export async function syncSource(root=process.cwd(),sourceOrId){root=path.resolve(root);const sources=await listSources(root),source=typeof sourceOrId==='string'?sources.find(x=>x.id===sourceOrId):sourceOrId;if(!source)throw new Error(`source not found: ${sourceOrId}`);if(source.enabled===false)return{id:source.id,skipped:true,reason:'disabled'};const fetched=await fetchText(source.manifestUrl||source.url);let items;if((source.adapter||'auto')==='reference') items=normalizeReference(fetched.text,source,fetched.finalUrl); else {let parsed=null;const looksJson=/json/i.test(fetched.contentType)||/^[\s\n\r]*[\[{]/.test(fetched.text);if(looksJson){try{parsed=JSON.parse(fetched.text);}catch(e){if(source.adapter!=='auto')throw new Error(`invalid JSON registry: ${e.message}`);}}if(parsed)items=normalizeRegistryPayload(parsed,source);else if(source.adapter==='auto')items=normalizeReference(fetched.text,source,fetched.finalUrl);else throw new Error(`adapter ${source.adapter} expected registry JSON`);}await writeSource(root,source.id,items);return{id:source.id,ok:true,items:items.length,codeIncluded:items.some(x=>x.ingest?.codeIncluded)};}
async function mapLimit(values,limit,worker){const out=new Array(values.length);let cursor=0;async function run(){while(cursor<values.length){const i=cursor++;try{out[i]=await worker(values[i]);}catch(e){out[i]={id:values[i]?.id,ok:false,error:e.message};}}}await Promise.all(Array.from({length:Math.min(limit,values.length)},run));return out;}
export async function syncSources(root=process.cwd(),options={}){root=path.resolve(root);const sources=(await listSources(root)).filter(x=>x.enabled!==false&&(!options.id||x.id===options.id));if(options.id&&!sources.length)throw new Error(`source not found: ${options.id}`);const results=await mapLimit(sources,Number(options.concurrency||4),s=>syncSource(root,s));const index=await rebuildIndex(root);return{results,index,failed:results.filter(x=>x?.ok===false).length};}

function safeDestination(projectRoot,relative){if(!relative||path.isAbsolute(relative))throw new Error(`unsafe file path: ${relative}`);const root=path.resolve(projectRoot),dest=path.resolve(root,relative);if(dest!==root&&!dest.startsWith(root+path.sep))throw new Error(`unsafe file path: ${relative}`);return dest;}
export async function installAsset(root=process.cwd(),id,projectRoot=process.cwd(),options={}){const item=getAsset(root,id);if(!item)throw new Error(`asset not found: ${id}`);if(!Array.isArray(item.files)||!item.files.length)throw new Error(`asset is not installable (no files): ${id}`);const filesWritten=[];for(const file of item.files){const dest=safeDestination(projectRoot,file.target||file.path);if(!options.force&&existsSync(dest))throw new Error(`refusing to overwrite existing file: ${path.relative(projectRoot,dest)}`);let content=file.content;if(typeof content!=='string'&&file.url)content=(await fetchText(new URL(file.url,item.source?.url).toString())).text;if(typeof content!=='string')throw new Error(`asset file has no cached content or URL: ${file.path}`);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,content);filesWritten.push(path.relative(path.resolve(projectRoot),dest));}
  const dependencies=uniq([...(item.dependencies||[]),...(item.devDependencies||[])]);let dependencyInstall={attempted:false,status:null};if(options.installDependencies!==false&&dependencies.length&&existsSync(path.join(path.resolve(projectRoot),'package.json'))){dependencyInstall.attempted=true;const r=spawnSync('npm',['install',...dependencies],{cwd:path.resolve(projectRoot),stdio:'inherit',shell:process.platform==='win32'});dependencyInstall.status=r.status;if(r.status!==0)throw new Error(`npm install failed with exit code ${r.status}`);}return{id,filesWritten,dependencies,registryDependencies:item.registryDependencies||[],dependencyInstall};}

export async function auditRegistry(root=process.cwd()){const rows=await readRows(path.resolve(root)),parseErrors=rows.filter(x=>x?.__parseError).map(x=>x.__parseError),seen=new Map(),duplicates=new Set(),missingLicense=new Set(),unsafeFiles=[];for(const item of rows){if(!item?.id||item.__parseError)continue;if(seen.has(item.id))duplicates.add(item.id);seen.set(item.id,item);if(!item.license?.id)missingLicense.add(item.id);for(const file of item.files||[]){try{safeDestination('/tmp/webforge-audit-root',file.target||file.path);}catch{unsafeFiles.push({id:item.id,path:file.target||file.path});}}}return{totalRows:rows.length-parseErrors.length,uniqueAssets:seen.size,duplicates:[...duplicates].sort(),missingLicense:[...missingLicense].sort(),unsafeFiles,parseErrors};}
export async function doctor(root=process.cwd()){await initWorkspace(root);const sources=await listSources(root),db=openDb(root);let indexedAssets=0;try{indexedAssets=Number(db.prepare('SELECT COUNT(*) n FROM assets').get().n);}finally{db.close();}return{version:VERSION,node:process.version,root:path.resolve(root),sources:sources.length,enabledSources:sources.filter(x=>x.enabled!==false).length,indexedAssets,sqlite:true};}
