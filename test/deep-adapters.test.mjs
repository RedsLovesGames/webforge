import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  initWorkspace, rebuildIndex, searchAssets, getAsset, installAsset, addSource, listSources, auditRegistry, tokenizeSearch,
  resolveAdapter, providerStatus, normalizeShadcnPayload, syncSource, searchAll, designSearch, designGet,
  discoverSources, listDiscovery, approveDiscovery, normalizeDeckCatalog, normalizeDesignPayload, DEFAULT_SOURCES
} from '../webforge.mjs';

async function ws(){ const d=await mkdtemp(path.join(tmpdir(),'wf2-')); await initWorkspace(d,{seedSources:false}); return d; }
const src=(over={})=>({id:'demo',name:'Demo',url:'https://example.test',adapter:'shadcn',allowCodeIngest:false,tags:[],license:'MIT',policy:{metadataAllowed:true,codeIngestAllowed:false},...over});

test('adapter resolver explicit, auto fallback, and unknown adapter', async()=>{
  assert.equal((await resolveAdapter({id:'x',adapter:'reference',url:'https://x'},{})).id,'reference');
  assert.equal((await resolveAdapter({id:'x',adapter:'auto',url:'https://x'},{fetchText:async()=>({text:'<title>X</title>',contentType:'text/html',finalUrl:'https://x'})})).id,'reference');
  await assert.rejects(()=>resolveAdapter({id:'x',adapter:'nope',url:'https://x'},{}),/unknown adapter/i);
});

test('rich shadcn normalization preserves metadata and install address', async()=>{
  const items=normalizeShadcnPayload({items:[{name:'hero',title:'Hero',description:'Hero section',type:'registry:block',categories:['marketing'],docs:'https://example.test/docs/hero',envVars:{NEXT_PUBLIC_DEMO:'required'},cssVars:{light:{primary:'0 0% 100%'}},css:{'.x':{color:'red'}},dependencies:['motion'],devDependencies:['vitest'],registryDependencies:['button'],files:[{path:'@components/hero.tsx',content:'secret'}]}]},src({namespace:'magicui'}));
  const item=items[0];
  assert.equal(item.id,'demo/hero'); assert.equal(item.type,'block');
  assert.deepEqual(item.categories,['marketing']); assert.equal(item.docs,'https://example.test/docs/hero');
  assert.deepEqual(item.envVars,{NEXT_PUBLIC_DEMO:'required'}); assert.equal(item.cssVars.light.primary,'0 0% 100%');
  assert.equal(item.install.mode,'shadcn'); assert.equal(item.install.address,'@magicui/hero');
  assert.equal(item.files[0].content,undefined);
});

test('shadcn code content is retained only when policy permits',()=>{
  const payload={name:'card',type:'registry:component',files:[{path:'components/card.tsx',content:'export const Card=1'}]};
  const off=normalizeShadcnPayload(payload,src())[0];
  const on=normalizeShadcnPayload(payload,src({allowCodeIngest:true,policy:{metadataAllowed:true,codeIngestAllowed:true}}))[0];
  assert.equal(off.files[0].content,undefined); assert.match(on.files[0].content,/Card/);
});

test('deck normalization creates attributed non-installable references',()=>{
  const items=normalizeDeckCatalog({decks:[{id:'d1',title:'Pitch',creator:'Ada',url:'https://deck.gallery/d1',tags:['saas']}],products:[{id:'p1',title:'Template',creator:'Lin',url:'https://deck.gallery/p1'}]}, {id:'deck-gallery',name:'Deck.gallery',url:'https://deck.gallery',tags:[]});
  assert.equal(items.length,2); assert.equal(items[0].meta.creator,'Ada'); assert.equal(items[0].install.mode,'none'); assert.equal(items[0].design.referenceUrl,'https://deck.gallery/d1');
});

test('design compact search excludes designMd and explicit get returns it', async()=>{
  const root=await ws(); const dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true});
  const [item]=normalizeDesignPayload([{id:'linear',title:'Linear Dark',description:'Technical dark UI',categories:['dashboard'],designMd:'# Full\nLots of tokens'}],{id:'refero-styles',name:'Refero',url:'https://styles.refero.design',tags:['styles']});
  await writeFile(path.join(dir,'refero-styles.jsonl'),JSON.stringify(item)+'\n'); await rebuildIndex(root);
  const hits=designSearch(root,'dark',{limit:5}); assert.equal(hits.length,1); assert.equal('designMd' in hits[0],false);
  assert.match(designGet(root,item.id).design.designMd,/Lots of tokens/);
});

test('discovery candidates require explicit approval', async()=>{
  const root=await ws();
  await discoverSources(root,{items:[{id:'new-ui',name:'New UI',url:'https://new-ui.example',tags:['components']}]});
  assert.equal((await listSources(root)).length,0); assert.equal((await listDiscovery(root))[0].status,'candidate');
  await approveDiscovery(root,'new-ui'); const sources=await listSources(root); assert.equal(sources.length,1); assert.equal(sources[0].allowCodeIngest,false);
});

test('remote auth failure does not break local results and result count is bounded', async()=>{
  const root=await ws(); const dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'local.jsonl'),JSON.stringify({id:'local/hero',name:'hero',title:'Hero',description:'dark hero',type:'block',source:{id:'local',url:'x'},tags:['dark'],files:[],install:{mode:'none'},license:{id:'MIT'}})+'\n'); await rebuildIndex(root);
  const r=await searchAll(root,'dark',{remote:true,limit:5,remoteProviders:[{id:'21st',search:async()=>({status:{ok:false,code:'auth_required',source:'21st'},results:Array.from({length:100},(_,i)=>({id:`21st/${i}`,title:'Dark',type:'component',source:{id:'21st'},tags:[]}))})}]});
  assert.equal(r.results.length<=5,true); assert.equal(r.providerStatuses[0].code,'auth_required'); assert.ok(r.results.some(x=>x.id==='local/hero'));
});

test('provider failure preserves previous snapshot', async()=>{
  const root=await ws(); await addSource(root,{id:'demo',url:'https://example.test',adapter:'catalog-json'});
  const dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true}); const file=path.join(dir,'demo.jsonl'); await writeFile(file,'{"id":"demo/old"}\n');
  const before=await readFile(file,'utf8');
  await assert.rejects(()=>syncSource(root,'demo',{context:{fetchJson:async()=>{throw Object.assign(new Error('offline'),{code:'unavailable'})}}}),/offline/);
  assert.equal(await readFile(file,'utf8'),before);
});

test('safe installer preserves traversal and overwrite protections', async()=>{
  const root=await ws(),dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'x.jsonl'),JSON.stringify({id:'x/card',title:'Card',type:'component',source:{id:'x'},tags:[],files:[{path:'components/card.tsx',content:'ok'}],install:{mode:'cached-files'},license:{id:'MIT'}})+'\n'); await rebuildIndex(root);
  const project=path.join(root,'project'); await mkdir(project);
  await installAsset(root,'x/card',project,{installDependencies:false}); assert.equal(await readFile(path.join(project,'components/card.tsx'),'utf8'),'ok');
  await assert.rejects(()=>installAsset(root,'x/card',project,{installDependencies:false}),/overwrite/i);
  await writeFile(path.join(dir,'bad.jsonl'),JSON.stringify({id:'x/bad',title:'Bad',type:'component',source:{id:'x'},tags:[],files:[{path:'../escape',content:'bad'}],install:{mode:'cached-files'},license:{id:'MIT'}})+'\n'); await rebuildIndex(root);
  await assert.rejects(()=>installAsset(root,'x/bad',project,{installDependencies:false}),/unsafe/i);
});

test('command install passes malicious item as a literal argument', async()=>{
  const root=await ws(),dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'cmd.jsonl'),JSON.stringify({id:'cmd/button;echo hacked',title:'B',type:'component',source:{id:'cmd'},tags:[],files:[],install:{mode:'command',executable:'demo-cli',args:['add','{item}']},license:{id:'MIT'}})+'\n'); await rebuildIndex(root);
  const calls=[]; await installAsset(root,'cmd/button;echo hacked',root,{context:{spawnCommand:async(executable,args)=>{calls.push({executable,args}); return {status:0};}}});
  assert.deepEqual(calls[0],{executable:'demo-cli',args:['add','button;echo hacked']});
});

test('legacy v0.1 rows remain searchable and filters work for v2 rows', async()=>{
  const root=await ws(),dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true});
  const rows=[{id:'old/x',title:'Old Dark Card',description:'legacy',type:'component',source:{id:'old'},tags:['dark'],files:[],license:{id:'MIT'}},{id:'new/y',title:'New Dark Block',description:'v2',type:'block',source:{id:'new'},tags:['dark'],categories:['marketing'],frameworks:['react'],files:[],install:{mode:'shadcn'},license:{id:'Apache-2.0'}}];
  await writeFile(path.join(dir,'rows.jsonl'),rows.map(JSON.stringify).join('\n')+'\n'); await rebuildIndex(root);
  assert.equal(searchAssets(root,'dark',{limit:10}).length,2); assert.equal(searchAssets(root,'dark',{license:'Apache-2.0',installable:true,limit:10})[0].id,'new/y');
});

test('catalog includes deep and broader ecosystem sources',()=>{
  const ids=new Set(DEFAULT_SOURCES.map(x=>x.id));
  for(const id of ['shadcn','21st','magicui','watermelon','motion-primitives','refero-styles','deck-gallery','vibeindex','base-ui','radix-ui','react-aria','daisyui','flowbite','preline','hyperui','lucide','iconify','fontsource','react-three-fiber','drei','recharts','echarts','visx','tanstack-table']) assert.ok(ids.has(id),id);
  assert.equal(DEFAULT_SOURCES.find(x=>x.id==='magicui').adapter,'shadcn');
  assert.equal(DEFAULT_SOURCES.find(x=>x.id==='motion-primitives').adapter,'command-provider');
});

test('audit reports unknown licenses and unsafe rows without crashing', async()=>{
  const root=await ws(),dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'a.jsonl'),JSON.stringify({id:'x/u',title:'U',type:'component',source:{id:'x'},tags:[],files:[{path:'../x'}]})+'\n');
  const report=await auditRegistry(root); assert.equal(report.missingLicense.length,1); assert.equal(report.unsafeFiles.length,1);
});

test('tokenizeSearch strips operators',()=>assert.equal(tokenizeSearch('dark OR dashboard: hero*'),'dark dashboard hero'));

test('MCP exposes old and new compact tools', async()=>{
  const root=await ws(); const child=spawn(process.execPath,[path.resolve('webforge.mjs'),'mcp','--root',root],{cwd:path.resolve('.'),stdio:['pipe','pipe','pipe']});
  const lines=[]; child.stdout.setEncoding('utf8'); let b=''; child.stdout.on('data',c=>{b+=c;const p=b.split('\n');b=p.pop();lines.push(...p.filter(Boolean));});
  const wait=async id=>{const s=Date.now();while(Date.now()-s<3000){for(const l of lines){const m=JSON.parse(l);if(m.id===id)return m;}await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');};
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})+'\n'); await wait(1);
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n'); const r=await wait(2); const names=r.result.tools.map(x=>x.name);
  for(const n of ['webforge_search','webforge_install','webforge_provider_status','webforge_search_remote','webforge_design_search','webforge_design_get','webforge_discover']) assert.ok(names.includes(n),n);
  child.stdin.end(); await new Promise(res=>child.once('close',res));
});

test('shadcn includes resolve and reject cycles and duplicate names', async()=>{
  const adapter=await resolveAdapter(src({manifestUrl:'https://r/root.json'}),{});
  const payloads={
    'https://r/root.json':{items:[{name:'root'}],include:['a.json']},
    'https://r/a.json':{items:[{name:'a'}],include:['b.json']},
    'https://r/b.json':{items:[{name:'b'}]}
  };
  const ctx={fetchJson:async url=>({data:payloads[url]}),writeSnapshot:async()=>{}};
  const items=await adapter.sync(src({manifestUrl:'https://r/root.json'}),ctx); assert.deepEqual(items.map(x=>x.name),['root','a','b']);
  payloads['https://r/b.json']={items:[{name:'b'}],include:['root.json']};
  await assert.rejects(()=>adapter.sync(src({manifestUrl:'https://r/root.json'}),ctx),/cycle/i);
  payloads['https://r/b.json']={items:[{name:'a'}]};
  await assert.rejects(()=>adapter.sync(src({manifestUrl:'https://r/root.json'}),ctx),/duplicate/i);
});

test('command provider status reports unavailable executable', async()=>{
  const status=await providerStatus({id:'motion',adapter:'command-provider',url:'https://x',command:{executable:'missing-tool',args:['add','{item}']}},{commandExists:async()=>false});
  assert.equal(status.ok,false); assert.equal(status.code,'unavailable');
});

test('sitemap-backed shadcn and command providers create item-level install records', async()=>{
  const xml='<urlset><url><loc>https://ui.example/docs/components/glow-card</loc></url><url><loc>https://ui.example/block/hero-12</loc></url></urlset>';
  const sh=await resolveAdapter({id:'wm',adapter:'shadcn',url:'https://ui.example',sitemapUrl:'https://ui.example/sitemap.xml',sitemapInclude:['/block/'],registryTemplate:'https://registry.example/r/{name}.json',tags:[]},{});
  const a=await sh.sync({id:'wm',name:'WM',adapter:'shadcn',url:'https://ui.example',sitemapUrl:'https://ui.example/sitemap.xml',sitemapInclude:['/block/'],registryTemplate:'https://registry.example/r/{name}.json',tags:[],policy:{codeIngestAllowed:false}}, {fetchText:async()=>({text:xml})});
  assert.equal(a.length,1); assert.equal(a[0].id,'wm/hero-12'); assert.equal(a[0].install.address,'https://registry.example/r/hero-12.json');
  const cmd=await resolveAdapter({id:'mp',adapter:'command-provider',url:'https://ui.example',command:{executable:'npx',args:['tool','add','{item}']}},{commandExists:async()=>true});
  const b=await cmd.sync({id:'mp',name:'MP',adapter:'command-provider',url:'https://ui.example',sitemapUrl:'https://ui.example/sitemap.xml',sitemapInclude:['/docs/components/'],command:{executable:'npx',args:['tool','add','{item}']},tags:[]},{fetchText:async()=>({text:xml})});
  assert.equal(b[0].id,'mp/glow-card'); assert.equal(b[0].install.mode,'command');
});

test('configured remote source participates only in opt-in search', async()=>{
  const root=await ws(); await addSource(root,{id:'21st',name:'21st',url:'https://21st.dev',adapter:'remote-provider',remote:true,authEnv:'API_KEY_21ST',remoteCommand:{executable:'fake21',args:['search','{query}','--json']}});
  const localOnly=await searchAll(root,'pricing',{limit:5}); assert.equal(localOnly.providerStatuses.length,0);
  const remote=await searchAll(root,'pricing',{remote:true,limit:5,context:{authToken:'x',commandExists:async()=>true,spawnCapture:async()=>({status:0,stdout:JSON.stringify({results:[{id:'pricing-1',title:'Pricing One',tags:['pricing']}]}) ,stderr:''})}});
  assert.equal(remote.providerStatuses[0].ok,true); assert.equal(remote.results[0].id,'21st/pricing-1');
});

test('VibeIndex discovery adapter feeds review queue but not sources', async()=>{
  const root=await ws(); await addSource(root,{id:'vibeindex',name:'VibeIndex',url:'https://vibeindex.dev',adapter:'vibeindex'});
  const html='<a href="https://cool-ui.example">Cool UI</a><a href="https://another.dev/tool">Another</a>';
  const queue=await discoverSources(root,{source:'vibeindex',context:{fetchText:async()=>({text:html})}});
  assert.equal(queue.length,2); assert.ok(queue.every(x=>x.status==='candidate')); assert.equal((await listSources(root)).length,1);
});

test('v0.1 derived SQLite schema is automatically replaced by v0.2 schema', async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'wf-old-db-')); await mkdir(path.join(root,'.webforge'),{recursive:true}); await mkdir(path.join(root,'registry/sources'),{recursive:true}); await writeFile(path.join(root,'sources.json'),'[]\n');
  const { DatabaseSync }=await import('node:sqlite'); const db=new DatabaseSync(path.join(root,'.webforge/index.sqlite')); db.exec('CREATE TABLE assets(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,type TEXT NOT NULL,source_id TEXT NOT NULL,tags TEXT NOT NULL,json TEXT NOT NULL); CREATE VIRTUAL TABLE asset_fts USING fts5(id UNINDEXED,title,description,tags,source,type);'); db.close();
  await writeFile(path.join(root,'registry/sources/legacy.jsonl'),JSON.stringify({id:'legacy/card',title:'Legacy Card',description:'old row',type:'component',source:{id:'legacy'},tags:['old'],files:[],license:{id:'MIT'}})+'\n');
  await rebuildIndex(root); assert.equal(searchAssets(root,'legacy',{limit:5})[0].id,'legacy/card');
});

test('Refero-style HTML discovery and lazy DESIGN.md get stay out of compact search', async()=>{
  const { normalizeDesignHtml }=await import('../src/adapters/design.mjs'); const { getDesign }=await import('../src/design.mjs');
  const source={id:'refero-styles',name:'Refero',url:'https://styles.refero.design',adapter:'design',detailTemplate:'https://styles.refero.design/style/{id}',tags:['styles']};
  const uuid='90ce5883-bb24-4466-93f7-801cd617b0d1'; const rows=normalizeDesignHtml(`<a href="/style/${uuid}"><span>Linear</span><span>midnight precision instrument</span></a>`,source); assert.equal(rows[0].id,`refero-styles/${uuid}`); assert.equal(rows[0].design.designMd,null);
  const root=await ws(); await addSource(root,source); const dir=path.join(root,'registry/sources'); await writeFile(path.join(dir,'refero-styles.jsonl'),JSON.stringify(rows[0])+'\n'); await rebuildIndex(root);
  const full=await getDesign(root,rows[0].id,{context:{fetchText:async()=>({text:`<h1>Linear</h1><pre><code># Linear — Style Reference\n\n**Theme:** dark\n\n## Tokens — Colors\n- Void: #08090a</code></pre>`})}}); assert.match(full.design.designMd,/Style Reference/); assert.equal('designMd' in designSearch(root,'Linear')[0],false);
});

test('cached-file install preserves v0.1 dependency installation behavior', async()=>{
  const root=await ws(),dir=path.join(root,'registry/sources'); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'dep.jsonl'),JSON.stringify({id:'dep/card',name:'card',title:'Card',type:'component',source:{id:'dep'},tags:[],dependencies:['motion'],devDependencies:['clsx'],files:[{path:'components/card.tsx',content:'ok'}],install:{mode:'cached-files'},license:{id:'MIT'}})+'\n'); await rebuildIndex(root);
  const project=path.join(root,'project'); await mkdir(project); await writeFile(path.join(project,'package.json'),'{}'); const calls=[];
  const out=await installAsset(root,'dep/card',project,{context:{spawnCommand:async(exe,args)=>{calls.push({exe,args});return {status:0};}}});
  assert.equal(out.dependencyInstall.attempted,true); assert.deepEqual(calls[0],{exe:'npm',args:['install','motion','clsx']});
});

test('v0.1 normalizeRegistryPayload export and modern MCP discover remain available', async()=>{
  const mod=await import('../webforge.mjs'); assert.equal(typeof mod.normalizeRegistryPayload,'function');
  const rows=mod.normalizeRegistryPayload({name:'legacy',type:'registry:component',files:[{path:'components/legacy.tsx'}]},{id:'legacy',url:'https://x',adapter:'shadcn',allowCodeIngest:false}); assert.equal(rows[0].id,'legacy/legacy');
  const root=await ws(); const child=spawn(process.execPath,[path.resolve('webforge.mjs'),'mcp','--root',root],{cwd:path.resolve('.'),stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',c=>out+=c);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:77,method:'server/discover',params:{}})+'\n');
  const start=Date.now();while(!out.includes('77')&&Date.now()-start<2000)await new Promise(r=>setTimeout(r,10));const msg=JSON.parse(out.trim().split('\n')[0]);assert.equal(msg.result.supportedVersions[0],'2026-07-28');child.stdin.end();await new Promise(r=>child.once('close',r));
});
