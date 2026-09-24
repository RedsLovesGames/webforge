import { referenceAdapter } from './reference.mjs';
import { shadcnAdapter } from './shadcn.mjs';
import { catalogJsonAdapter } from './catalog-json.mjs';
import { deckGalleryAdapter } from './deck-gallery.mjs';
import { designAdapter } from './design.mjs';
import { vibeIndexAdapter } from './vibeindex.mjs';
import { commandProviderAdapter } from './command-provider.mjs';
import { remoteProviderAdapter } from './remote-provider.mjs';
const adapters=[shadcnAdapter,deckGalleryAdapter,designAdapter,vibeIndexAdapter,commandProviderAdapter,remoteProviderAdapter,catalogJsonAdapter,referenceAdapter];
const map=new Map(adapters.map(x=>[x.id,x]));
export async function resolveAdapter(source,context={}){const id=source.adapter||'auto';if(id!=='auto'){const a=map.get(id);if(!a)throw new Error(`unknown adapter: ${id}`);return a;}for(const a of adapters.filter(x=>x.id!=='reference')){try{const p=await a.probe(source,context);if(p?.ok&&Number(p.score||0)>=50)return a;}catch{}}return referenceAdapter;}
export async function providerStatus(source,context={}){try{const adapter=await resolveAdapter(source,context);const probe=await adapter.probe(source,context);if(probe?.ok===false)return {ok:false,source:source.id,adapter:adapter.id,code:probe.code||'unavailable',message:probe.message||'provider unavailable',capabilities:probe.capabilities||[],auth:probe.auth||'none'};return {ok:true,source:source.id,adapter:adapter.id,capabilities:probe?.capabilities||[],auth:probe?.auth||'none'};}catch(e){return {ok:false,source:source.id,code:e.code||'unsupported',message:e.message};}}
export { referenceAdapter, shadcnAdapter, catalogJsonAdapter, deckGalleryAdapter, designAdapter, vibeIndexAdapter, commandProviderAdapter, remoteProviderAdapter };
