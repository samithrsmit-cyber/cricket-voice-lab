const $ = (selector) => document.querySelector(selector);
const commentary = $('#commentary');
const status = $('#status');
const speakButton = $('#speak');
const stopButton = $('#stop');
let generatedAudio = null;

function setStatus(message, isError = false) { status.textContent = message; status.classList.toggle('error', isError); }
function numberValue(id, divisor = 1) { return Number($(`#${id}`).value) / divisor; }
function updateLabels() {
  const rate = Number($('#rate').value), pitch = Number($('#pitch').value);
  $('#rate-output').value = rate === 0 ? 'Normal' : `${rate > 0 ? '+' : ''}${rate}`;
  $('#volume-output').value = `${$('#volume').value}%`;
  $('#pitch-output').value = pitch === 0 ? 'Neutral' : `${pitch > 0 ? '+' : ''}${pitch}`;
  $('#exaggeration-output').value = numberValue('exaggeration', 100).toFixed(2);
  $('#cfg-weight-output').value = numberValue('cfg-weight', 100).toFixed(2);
  $('#temperature-output').value = numberValue('temperature', 100).toFixed(2);
  $('#repetition-penalty-output').value = numberValue('repetition-penalty', 100).toFixed(2);
  $('#seed-output').value = $('#seed').value || 'Random';
}
const presets = { calm:[-2,68,-1,28,42,66,125], standard:[0,80,0,45,50,80,120], boundary:[4,95,4,74,58,92,118], wicket:[2,96,2,82,64,86,122], 'final-over':[5,92,3,90,68,96,116] };
function applyPreset() { const [rate,volume,pitch,exaggeration,cfg,temperature,repetition] = presets[$('#preset').value]; $('#rate').value=rate; $('#volume').value=volume; $('#pitch').value=pitch; $('#exaggeration').value=exaggeration; $('#cfg-weight').value=cfg; $('#temperature').value=temperature; $('#repetition-penalty').value=repetition; updateLabels(); }
function settings() { return { text: commentary.value.trim(), language: $('#language').value, exaggeration:numberValue('exaggeration',100), cfg_weight:numberValue('cfg-weight',100), temperature:numberValue('temperature',100), repetition_penalty:numberValue('repetition-penalty',100), seed:$('#seed').value }; }
async function checkSetup() {
  if (window.location.protocol === 'file:') {
    speakButton.disabled = true;
    setStatus('This page was opened as a file. Start Cricket Voice Lab, then use http://127.0.0.1:8771 — Chatterbox needs its local service running.', true);
    return;
  }
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    setStatus(data.message, !data.ready);
    speakButton.disabled = !data.ready;
  } catch {
    setStatus('The local Chatterbox service is not running. Start Cricket Voice Lab first.', true);
    window.setTimeout(checkSetup, 1500);
  }
}
async function generate() { const payload=settings(); if (!payload.text) return setStatus('Enter commentary text first.', true); speakButton.disabled=true; setStatus('Generating expressive Chatterbox audio locally… this may take a little time.'); try { const response = await fetch('/api/generate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)}); const data=await response.json(); if (!response.ok) throw new Error(data.error || 'Generation failed.'); if (generatedAudio) generatedAudio.pause(); generatedAudio = new Audio(`${data.audio}?v=${Date.now()}`); generatedAudio.onended=()=>{stopButton.disabled=true; setStatus('Audio finished. Adjust Exaggeration and generate another take.');}; generatedAudio.play(); stopButton.disabled=false; setStatus(data.message); } catch (error) { setStatus(error.message, true); } finally { speakButton.disabled=false; } }
function stop() { if(generatedAudio){generatedAudio.pause(); generatedAudio.currentTime=0;} stopButton.disabled=true; setStatus('Audio stopped.'); }
function copySettings() { navigator.clipboard.writeText(JSON.stringify(settings(),null,2)).then(()=>setStatus('Chatterbox settings copied.')).catch(()=>setStatus('Could not copy settings.',true)); }
commentary.addEventListener('input',()=>$('#character-count').textContent=`${commentary.value.length.toLocaleString()} / 5,000`); $('#preset').addEventListener('change',applyPreset); ['rate','volume','pitch','exaggeration','cfg-weight','temperature','repetition-penalty','seed'].forEach(id=>$('#'+id).addEventListener('input',updateLabels)); speakButton.addEventListener('click',generate); stopButton.addEventListener('click',stop); $('#copy-settings').addEventListener('click',copySettings); updateLabels(); commentary.dispatchEvent(new Event('input')); checkSetup();
