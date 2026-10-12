// Isolated local review/recording account. Never replaces the user's normal cookie.
import {randomUUID} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';import {resolve} from 'node:path';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const recordings=new Map();
const {server,store}=await createApp({path:resolve('data/competition-review-20261011.json')});
const appHandler=server.listeners('request')[0];server.removeAllListeners('request');
server.on('request',async(req,res)=>{const address=server.address();if(![`localhost:${address.port}`,`127.0.0.1:${address.port}`].includes(req.headers.host)){res.writeHead(403);res.end('Local host required.');return;}
const route=req.url.split('?')[0];if(req.method==='GET'&&['/record','/recorder.js'].includes(route)){res.writeHead(200,{'Content-Type':route==='/record'?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(resolve('demo-recording',route==='/record'?'recorder.html':'recorder.js')));return;}
const id=req.headers.cookie?.match(/(?:^|;\s*)finmate_competition_review_session=([a-f0-9]{64})(?:;|$)/)?.[1];
if(req.method==='POST'&&route.startsWith('/recording/')){
 if(req.headers.origin!==`http://${req.headers.host}`||!id||!store.sessions[id]){res.writeHead(403);res.end('Matching local review session required');return;}
 const json=value=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{if(route==='/recording/start'){const recordingId=randomUUID(),path=resolve('demo-recording',`take-${recordingId}.webm`);recordings.set(id,{recordingId,path,bytes:0,started:Date.now(),done:false});await writeFile(path,new Uint8Array());json({recordingId});return;}
 const record=recordings.get(id),inputId=new URL(req.url,`http://${req.headers.host}`).searchParams.get('id');if(!record||record.done||inputId!==record.recordingId)throw Error('No matching active recording');
 if(route==='/recording/chunk'){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>4000000)throw Error('Chunk too large');chunks.push(chunk);}if(record.bytes+bytes>100000000)throw Error('Recording too large');await appendFile(record.path,Buffer.concat(chunks));record.bytes+=bytes;json({bytes:record.bytes});return;}
 if(route==='/recording/finish'){record.done=true;await writeFile(record.path+'.json',JSON.stringify({recordingId:record.recordingId,bytes:record.bytes,started:record.started,finished:Date.now(),syntheticAccount:true},null,2));json({saved:true,file:`take-${record.recordingId}.webm`,bytes:record.bytes});return;}
 throw Error('Unknown recording route');}catch{res.writeHead(400);res.end('Recording could not be saved. Use the browser download.');return;}
}
req.headers.cookie=id?`finmate_session=${id}`:'';
const set=res.setHeader.bind(res);res.setHeader=(name,value)=>set(name,name.toLowerCase()==='set-cookie'?String(value).replace(/^finmate_session=/,'finmate_competition_review_session='):value);
const head=res.writeHead.bind(res);res.writeHead=(code,headers)=>{if(headers?.['Content-Security-Policy'])headers['Content-Security-Policy']=headers['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'");if(res.getHeader('X-Frame-Options'))res.setHeader('X-Frame-Options','SAMEORIGIN');return head(code,headers);};appHandler(req,res);
});server.listen(52927,'127.0.0.1',()=>console.log('Isolated review: http://localhost:52927/ · recorder /record'));
