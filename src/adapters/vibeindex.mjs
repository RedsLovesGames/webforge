import { normalizeCatalog } from './catalog-json.mjs';
function externalLinks(html,base){const host=new URL(base).hostname,seen=new Set(),items=[];for(const m of String(html||'').matchAll(/href=["'](https?:\/\/[^"'#?\s]+)["']/gi)){try{const url=new URL(m[1]);if(url.hostname===host||seen.has(url.toString()))continue;seen.add(url.toString());const id=url.hostname.replace(/^www\./,'').replace(/[^a-z0-9]+/gi,'-').toLowerCase();items.push({id,name:id,title:id,url:url.toString(),tags:['discovered']});}catch{}}return items;}
export const vibeIndexAdapter={
  id:'vibeindex',
  async probe(source){return {ok:source.id==='vibeindex'||source.adapter==='vibeindex',score:100,capabilities:['discovery']};},
  async sync(source,context){
    if(source.items)return normalizeCatalog({items:source.items},source);
    if(source.manifestUrl||source.apiUrl){const {data}=await context.fetchJson(source.manifestUrl||source.apiUrl,{sourceId:source.id});return normalizeCatalog(data,source);}
    const {text}=await context.fetchText(source.url,{sourceId:source.id});
    return normalizeCatalog({items:externalLinks(text,source.url)},source);
  }
};
