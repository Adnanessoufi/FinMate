const start=document.querySelector('#start'),stop=document.querySelector('#stop'),status=document.querySelector('#status'),app=document.querySelector('#app');
let stream,recorder,chunks=[],ended=false,recordingId=null,saveQueue=Promise.resolve(),saveFailed=false;
function finish(){if(recorder?.state==='recording')recorder.stop();}
function key(event){if(event.altKey&&event.shiftKey&&event.code==='KeyS'){event.preventDefault();finish();}}
document.addEventListener('keydown',key);
app.addEventListener('load',()=>{try{app.contentDocument.addEventListener('keydown',key);app.contentDocument.addEventListener('pointerdown',event=>{if(!document.body.classList.contains('recording'))return;const r=app.getBoundingClientRect(),ring=document.createElement('div');ring.className='click-ring';ring.style.left=(r.left+event.clientX-19)+'px';ring.style.top=(r.top+event.clientY-19)+'px';document.body.append(ring);setTimeout(()=>ring.remove(),600);});}catch{}});
start.addEventListener('click',async()=>{
 start.disabled=true;status.textContent='Select this FinMate recorder tab in the sharing picker.';
 try{
  if(!navigator.mediaDevices?.getDisplayMedia||!window.MediaRecorder)throw new Error('Screen recording is unavailable in this embedded browser. Open this same URL in desktop Chrome or Edge.');
  stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30,displaySurface:'browser',cursor:'always'},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude',systemAudio:'exclude'});
  recordingId=null;saveQueue=Promise.resolve();saveFailed=false;try{const response=await fetch('/recording/start',{method:'POST'});if(response.ok)recordingId=(await response.json()).recordingId;}catch{}
  const track=stream.getVideoTracks()[0];const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:6000000});chunks=[];ended=false;
  recorder.addEventListener('dataavailable',event=>{if(event.data.size){chunks.push(event.data);if(recordingId)saveQueue=saveQueue.then(async()=>{const response=await fetch('/recording/chunk?id='+encodeURIComponent(recordingId),{method:'POST',headers:{'Content-Type':'video/webm'},body:event.data});if(!response.ok)saveFailed=true;}).catch(()=>{saveFailed=true;});}});
  recorder.addEventListener('stop',async()=>{if(ended)return;ended=true;stream.getTracks().forEach(t=>t.stop());document.body.classList.remove('recording');stop.disabled=true;start.disabled=false;await saveQueue;if(recordingId&&!saveFailed){try{const response=await fetch('/recording/finish?id='+encodeURIComponent(recordingId),{method:'POST'});if(response.ok){const saved=await response.json();status.textContent='Recording saved locally: '+saved.file;return;}}catch{}}const blob=new Blob(chunks,{type:recorder.mimeType||'video/webm'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='FinMate-live-recording.webm';link.textContent='Download your recording';status.textContent='Recording complete. ';status.append(link);link.click();setTimeout(()=>URL.revokeObjectURL(url),600000);});
  track.addEventListener('ended',finish);recorder.start(1000);document.body.classList.add('recording');stop.disabled=false;status.textContent='Recording in progress.';
 }catch(error){stream?.getTracks().forEach(t=>t.stop());start.disabled=false;status.textContent=error.name==='NotAllowedError'?'Capture was cancelled or blocked. Open this page in Chrome or Edge and choose the FinMate tab.':error.message;}
});stop.addEventListener('click',finish);document.querySelector('#floating-stop').addEventListener('click',finish);
