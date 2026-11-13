/* 说高棉语 — 主程序
 * 念和听：默认谷歌 Gemini 接口（也保留了微软 Azure）；翻译：谷歌 Gemini 或 Claude，可在设置里切换。都是浏览器直接调用。
 * 密钥只存在这台手机的浏览器里，不写进代码。
 */
(function () {
'use strict';

window.__km = {};   // 调试用
/* ---------- 小工具 ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const view = $('#view');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const day = (d) => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dayPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return day(d); };
const isKm = s => /[\u1780-\u17FF]/.test(s || '');
/* 比较高棉文时去掉空格、零宽字符和标点 */
const normKm = s => String(s || '').replace(/[\s\u200B-\u200D\uFEFF។៕៖?!.,，。？！"'“”]/g, '');
const normZh = s => String(s || '').trim().replace(/[\s，。！？、,.!?~～]/g, '');

class AppErr extends Error { constructor(zh, detail) { super(zh); this.zh = zh; this.detail = detail || ''; } }
function errHTML(e) {
  const zh = e instanceof AppErr ? e.zh : '程序出错了';
  const detail = e instanceof AppErr ? e.detail : (e && (e.stack || e.message || String(e)));
  return `<div class="err"><b>${esc(zh)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
}
function showErr(e, el) { console.error(e); const box = el || $('#msg'); if (box) box.innerHTML = errHTML(e); }
function clearMsg() { const m = $('#msg'); if (m) m.innerHTML = ''; }

/* ---------- 存储：进度在 localStorage，声音和常用句在 IndexedDB ---------- */
const LS = 'km_app_v1';
function defState() {
  return { set: { speech: 'google', gKey: '', gModel: 'gemini-3.8-flash', trEngine: 'gemini', voiceF: 'Fola', voiceM: 'Rami', voiceNote: '', azKey: '', azRegion: 'southeastasia', clKey: '', model: 'claude-fable-5-2', voice: 'f', theme: 'light', addr: '' },
    gloss: [{ zh: '机器、贩卖机', km: 'ម៉ាស៊ីន' }],   // 只放本地人没提出异议的。2026-11-13 本地人指出 ដាក់ទឹកថែម 听起来是"加水"不是"补货"，那两条是 Claude 自己猜的，已撤掉
    glossV: 2,
    units: {}, ear: {}, boss: {}, flags: {}, rev: {}, streak: { last: '', days: 0 }, mission: null, missionLog: [], log: [] };
}
let S = (function () {
  const d = defState();
  try { const p = JSON.parse(localStorage.getItem(LS) || '{}'); Object.assign(d, p); d.set = Object.assign(defState().set, p.set || {});
    if (p.gloss && p.glossV !== 2) { d.gloss = p.gloss.filter(g => !((g.zh === '补货、补饮料' && g.km === 'ដាក់ទឹកថែម') || (g.zh === '饮料' && g.km === 'ទឹក'))); d.glossV = 2; }   // 把早先自带的两条猜错的说法清掉，用户自己加的不动
  } catch (e) { console.warn(e); }
  return d;
})();
function applyTheme() { const t = S.set.theme === 'dark' ? 'dark' : 'light'; document.documentElement.dataset.theme = t; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0B1020' : '#F4F6FB'; }
applyTheme();
function save() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { console.warn('存进度失败', e); } }

let dbp;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('km_app', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('audio'); r.result.createObjectStore('phrases'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode); const rq = fn(tx.objectStore(store));
    tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}

/* ---------- 微软语音 ---------- */
const VOICES = { f: 'km-KH-SreymomNeural', m: 'km-KH-PisethNeural' };
function azCfg() {
  const key = S.set.azKey.trim(), region = S.set.azRegion.trim().toLowerCase();
  if (!key) throw new AppErr('还没填微软语音密钥', '到"设置"里填上密钥和区域');
  if (!/^[a-z0-9]+$/.test(region)) throw new AppErr('微软语音的区域写法不对', '应该是像 southeastasia、eastasia 这样的小写英文，当前填的是：' + (region || '（空）'));
  return { key, region };
}
function netErr(who, e) { return new AppErr(who + '连不上，检查手机网络', String(e && e.message || e)); }
async function azErr(r, what) {
  let body = ''; try { body = (await r.text()).slice(0, 300); } catch (e) {}
  const map = { 401: '微软语音密钥不对，或者密钥和区域对不上', 403: '微软语音拒绝了这个密钥（可能是区域不对或资源被停用）', 429: '微软语音调用太频繁，或者本月免费额度用完了', 400: '微软语音不接受这次' + what + '请求' };
  return new AppErr(map[r.status] || ('微软语音' + what + '失败'), 'HTTP ' + r.status + (body ? ' · ' + body : ''));
}
let ttsActive = 0; const ttsWait = [];
async function azTts(text, voice, slow) {
  const { key, region } = azCfg();
  if (ttsActive >= 2) await new Promise(r => ttsWait.push(r));
  ttsActive++;
  try {
    const ssml = `<speak version='1.0' xml:lang='km-KH'><voice name='${VOICES[voice]}'><prosody rate='${slow ? '-35%' : '0%'}'>${xml(text)}</prosody></voice></speak>`;
    for (let i = 0; ; i++) {
      let r;
      try {
        r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' }, body: ssml });
      } catch (e) { throw netErr('微软语音', e); }
      if (r.status === 429 && i < 4) { await sleep((Number(r.headers.get('Retry-After')) || 3 * (i + 1)) * 1000); continue; }
      if (!r.ok) throw await azErr(r, '发音');
      const buf = await r.arrayBuffer();
      if (buf.byteLength < 200) throw new AppErr('微软语音返回了空的声音', '文字：' + text + ' · 字节数 ' + buf.byteLength);
      return buf;
    }
  } finally { ttsActive--; const w = ttsWait.shift(); if (w) w(); }
}
/* ---------- 谷歌 Gemini：念、听、翻，都用同一个密钥 ---------- */
const G_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
const G_PREBUILT = { f: 'Kore', m: 'Puck' };   // 接口文档里写明的自带嗓音，后台嗓音库的名字接口不认时退回用它
function gKey() { const k = S.set.gKey.trim(); if (!k) throw new AppErr('还没填谷歌密钥', '到"设置"里填上'); return k; }
async function gErr(r, what) {
  let body = ''; try { body = await r.text(); } catch (e) {}
  let msg = body, st = ''; try { let j = JSON.parse(body); if (Array.isArray(j)) j = j[0]; j = j.error; msg = j.message; st = j.status || (typeof j.code === 'string' ? j.code : ''); } catch (e) {}
  let zh = '谷歌' + what + '失败';
  if (/API key not valid|API_KEY_INVALID/i.test(body)) zh = '谷歌密钥不对';
  else if (r.status === 429) zh = '谷歌调用太频繁，或者免费额度用完了';
  else if (r.status === 403) zh = '谷歌拒绝了这个密钥（可能没开通这个型号，或者要先开通付费）';
  else if (r.status === 404) zh = '谷歌找不到这个型号或接口';
  else if (/location is not supported|not available in your/i.test(msg)) zh = '谷歌说当前地区不能用这个接口';
  const e = new AppErr(zh, 'HTTP ' + r.status + (st ? ' ' + st : '') + ' · ' + String(msg).slice(0, 300)); e.http = r.status; e.raw = String(msg); return e;
}
async function gPost(path, body, what) {
  const key = gKey();
  for (let i = 0; ; i++) {
    let r;
    try { r = await fetch(G_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }); }
    catch (e) { throw netErr('谷歌', e); }
    if (r.status === 429 && i < 3) { await sleep((Number(r.headers.get('Retry-After')) || 4 * (i + 1)) * 1000); continue; }
    if (!r.ok) throw await gErr(r, what);
    return r.json();
  }
}
/* 从谷歌的回复里取出文字。新接口放在 steps[].content[].text，旧接口放在 candidates[0].content.parts[].text，两种都认 */
function gText(j) {
  if (j && typeof j.output_text === 'string') return j.output_text;
  const steps = (j && (j.steps || j.outputs)) || [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = (steps[i].content || []).filter(c => typeof c.text === 'string' && (!c.type || c.type === 'text')).map(c => c.text).join('');
    if (t) return t;
  }
  const c = j && j.candidates && j.candidates[0];
  if (c && c.content && c.content.parts) return c.content.parts.filter(p => !p.thought).map(p => p.text || '').join('');
  return '';
}
function b64ToBuf(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
function blobToB64(blob) { return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = () => rej(f.error); f.readAsDataURL(blob); }); }
const isRiff = buf => { const u = new Uint8Array(buf, 0, 4); return u[0] === 82 && u[1] === 73 && u[2] === 70 && u[3] === 70; };
function pcmToWav(pcm, rate) {   // 谷歌有时返回不带文件头的原始声波，补一个头才能播
  const h = new DataView(new ArrayBuffer(44)), W = (p, s) => { for (let i = 0; i < s.length; i++) h.setUint8(p + i, s.charCodeAt(i)); };
  W(0, 'RIFF'); h.setUint32(4, 36 + pcm.byteLength, true); W(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength); out.set(new Uint8Array(h.buffer), 0); out.set(new Uint8Array(pcm), 44); return out.buffer;
}
async function gTtsOnce(text, name) {
  const j = await gPost('models/gemini-3.8-flash-tts:generateContent', {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: name } } } }, '发音');
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const d = parts.map(p => p.inlineData || p.inline_data).find(Boolean);
  if (!d || !d.data) throw new AppErr('谷歌没有返回声音', JSON.stringify(j).slice(0, 300));
  let buf = b64ToBuf(d.data);
  if (buf.byteLength < 200) throw new AppErr('谷歌返回了空的声音', '文字：' + text + ' · 字节数 ' + buf.byteLength);
  if (!isRiff(buf)) { const m = /rate=(\d+)/.exec(d.mimeType || d.mime_type || ''); buf = pcmToWav(buf, m ? +m[1] : 24000); }
  return buf;
}
async function gTts(text, voice) {
  gKey();
  if (ttsActive >= 2) await new Promise(r => ttsWait.push(r));
  ttsActive++;
  try {
    const name = voiceName(voice);
    try { return await gTtsOnce(text, name); }
    catch (e) {
      if (e.http === 400 && /voice/i.test(e.raw || '') && name !== G_PREBUILT[voice]) {
        S.set[voice === 'm' ? 'voiceM' : 'voiceF'] = G_PREBUILT[voice];
        S.set.voiceNote = `嗓音「${name}」接口不认（${e.raw.slice(0, 80)}），已自动改用接口自带的「${G_PREBUILT[voice]}」。`; save();
        return await gTtsOnce(text, G_PREBUILT[voice]);
      }
      throw e;
    }
  } finally { ttsActive--; const w = ttsWait.shift(); if (w) w(); }
}
/* 听写。2026-11-13 用真密钥实测：专用听写型号听高棉语，句尾常混进别种文字的字母；通用型号按"听写员"的要求来听反而一字不差，也更快。
 * 所以以通用型号为主；高棉语再让专用听写型号听一遍当对照（最多多等 2.5 秒），两个结果都交给"开口"判定用。 */
async function gStt(wav, lang) {
  const zh = lang === 'zh-CN', data = await blobToB64(wav);
  const main = gGen(`你是听写员。把录音里说的话一字不差地写下来，用${zh ? '简体中文' : '高棉文'}。只输出听到的原话，不要翻译、不要解释、不要补充、不要纠正说话人的错误。如果没有人说话或者完全听不清，只输出一个空格。`,
    [{ inlineData: { mimeType: 'audio/wav', data } }, { text: '请听写这段录音。' }], '听写', true);
  const second = zh ? null : gPost('interactions', { model: 'models/gemini-3.5-transcribe', input: [{ type: 'audio', data, mime_type: 'audio/wav' }],
    generation_config: { transcription_config: { language_codes: ['km-KH'] } } }, '听写').then(j => gText(j).trim(), e => { console.warn('专用听写型号这次没用上', e); return ''; });
  const text = (await main).trim();
  const t2 = second ? await Promise.race([second, sleep(2500).then(() => '')]) : '';
  const alts = [text, t2].filter((t, i, arr) => t && arr.indexOf(t) === i);
  return { ok: !!alts.length, status: alts.length ? 'Success' : '没有听到内容', text: alts[0] || '', alts, via: t2 ? '通用型号，专用听写型号对照听到：' + t2 : '通用型号' };
}
/* 通用型号（翻译、边听边翻）：走 generateContent 接口，思考档位调到"低"。
 * 2026-11-13 用真密钥实测：同一句话走新的 interactions 接口要 5~35 秒，走这个接口 2~3 秒；默认档位会先"想"一千多字，又慢又多花钱。 */
async function gGen(system, parts, what, emptyOk) {
  const path = 'models/' + S.set.gModel + ':generateContent';
  const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } };
  let j;
  try { j = await gPost(path, body, what); }
  catch (e) { if (e.http !== 400 || !/thinking/i.test(e.raw || '')) throw e; delete body.generationConfig; j = await gPost(path, body, what); }   // 这个型号不认"思考档位"就不带
  const t = gText(j);
  if (!t && !emptyOk) throw new AppErr('谷歌没有返回文字', JSON.stringify(j).slice(0, 300));
  return t;
}
const gemini = (system, user) => gGen(system, [{ text: user }], '翻译');

/* ---------- 统一入口：按设置决定用哪家 ---------- */
const useAz = () => S.set.speech === 'azure';
function voiceName(v) { return useAz() ? VOICES[v] : String((v === 'm' ? S.set.voiceM : S.set.voiceF) || G_PREBUILT[v]).trim(); }
function ttsFetch(text, voice, slow) { return useAz() ? azTts(text, voice, slow) : gTts(text, voice); }
function stt(wav, lang) { return useAz() ? azStt(wav, lang) : gStt(wav, lang); }
function llm(system, user, engine) { return (engine || S.set.trEngine) === 'claude' ? claude(system, user) : gemini(system, user); }
const engineName = e => (e || S.set.trEngine) === 'claude' ? 'Claude' : '谷歌';
function missingKeys() {
  const m = [];
  if (useAz() ? !S.set.azKey : !S.set.gKey) m.push(useAz() ? '微软语音密钥' : '谷歌密钥');
  if (S.set.trEngine === 'claude') { if (!S.set.clKey) m.push('Claude 密钥'); } else if (!S.set.gKey && !m.includes('谷歌密钥')) m.push('谷歌密钥');
  return m;
}

const inflight = new Map();
async function ttsBuf(text, voice, slow) {
  voice = voice || S.set.voice; slow = useAz() && !!slow;   // 谷歌没有慢速版，慢速靠放慢播放
  const k = `${useAz() ? 'az' : 'g'}|${voiceName(voice)}|${slow ? 's' : 'n'}|${text}`;
  let hit = null; try { hit = await idb('audio', 'readonly', s => s.get(k)); } catch (e) { console.warn(e); }
  if (hit) return hit;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => { const buf = await ttsFetch(text, voice, slow); try { await idb('audio', 'readwrite', s => s.put(buf, k)); } catch (e) { console.warn('声音没存进手机', e); } return buf; })();
  inflight.set(k, p);
  try { return await p; } finally { inflight.delete(k); }
}
async function azStt(wav, lang) {
  const { key, region } = azCfg();
  let r;
  try {
    r = await fetch(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}&format=detailed&profanity=raw`, { method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', 'Accept': 'application/json' }, body: wav });
  } catch (e) { throw netErr('微软语音', e); }
  if (!r.ok) throw await azErr(r, '听写');
  const j = await r.json();
  if (j.RecognitionStatus !== 'Success') return { ok: false, status: j.RecognitionStatus, text: '', alts: [] };
  const alts = (j.NBest || []).map(n => n.Display || n.Lexical || '').filter(Boolean);
  const text = j.DisplayText || alts[0] || '';
  if (text && !alts.includes(text)) alts.unshift(text);
  return { ok: !!text, status: text ? 'Success' : 'Empty', text, alts };
}

/* ---------- 播放 ---------- */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const audio = new Audio(); audio.preload = 'auto';
let curUrl = null, playTok = 0, pendingPlay = null;
function settlePlay() { const f = pendingPlay; pendingPlay = null; if (f) f(); }
document.addEventListener('pointerdown', function unlock() {
  /* 手机浏览器要求第一次出声必须由手指触发，这里先"解锁"一次 */
  if (!audio.src) { audio.src = SILENT; const p = audio.play(); if (p) p.then(() => { if (audio.src.startsWith('data:')) audio.pause(); }).catch(() => {}); }
}, { once: true, capture: true });
function stopAudio() { playTok++; try { audio.pause(); } catch (e) {} audio.onended = audio.onerror = null; settlePlay(); }
function playBuf(buf, rate) {
  return new Promise((res, rej) => {
    try { audio.pause(); } catch (e) {}
    settlePlay(); pendingPlay = res;
    if (curUrl) URL.revokeObjectURL(curUrl);
    curUrl = URL.createObjectURL(new Blob([buf], { type: isRiff(buf) ? 'audio/wav' : 'audio/mpeg' }));
    audio.onended = () => { if (pendingPlay === res) pendingPlay = null; res(); };
    audio.onerror = () => rej(new AppErr('这段声音播不出来', '播放器错误码 ' + (audio.error && audio.error.code)));
    audio.src = curUrl; audio.defaultPlaybackRate = audio.playbackRate = rate || 1;
    const p = audio.play();
    if (p) p.catch(e => { if (e && e.name === 'AbortError') res(); else rej(new AppErr('手机拦住了自动出声，再点一下"播放"', String(e))); });
  });
}
async function say(text, opt) {
  opt = opt || {}; const tok = ++playTok;
  const buf = await ttsBuf(text, opt.voice, !!opt.slow);
  if (tok !== playTok) return;
  await playBuf(buf, opt.slow && !useAz() ? 0.7 : 1);
}
async function sayWords(words, onWord) {
  const tok = ++playTok;
  const bufs = await Promise.all(words.map(w => ttsBuf(w.km, null, true)));
  for (let i = 0; i < words.length; i++) {
    if (tok !== playTok) return;
    onWord && onWord(i);
    await playBuf(bufs[i], useAz() ? 1 : 0.85);
    await sleep(380);
  }
  if (tok === playTok && onWord) onWord(-1);
}

/* ---------- 录音：直接取原始声波，转成 16k 的 WAV，苹果安卓都一样 ---------- */
/* 直接双击文件打开时（地址以 file: 开头），Chrome 记不住麦克风授权，每次都会重新问。所以这种情况下麦克风开着不关，只问一次 */
const KEEP_MIC = location.protocol === 'file:';
const Rec = {
  on: false,
  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new AppErr('这个页面现在用不了麦克风', '手机上必须用 https 开头的网址打开才能录音。当前地址：' + location.origin);
    try { if (!this.stream || !this.stream.active) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { throw new AppErr(e.name === 'NotAllowedError' ? '麦克风权限被拒绝了，到浏览器设置里允许这个网页用麦克风' : '打不开麦克风', e.name + ': ' + e.message); }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC(); await this.ctx.resume();
    this.node = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.proc.onaudioprocess = e => { if (!this.on) return; const d = e.inputBuffer.getChannelData(0); this.chunks.push(new Float32Array(d)); if (this.onLevel) { let m = 0; for (let i = 0; i < d.length; i += 16) m = Math.max(m, Math.abs(d[i])); this.onLevel(m); } };
    this.node.connect(this.proc); this.proc.connect(this.ctx.destination);
    this.on = true; this.t0 = Date.now();
  },
  async stop() {
    if (!this.on) return null;
    this.on = false; this.onLevel = null;
    const rate = this.ctx.sampleRate, chunks = this.chunks;
    try { this.proc.disconnect(); this.node.disconnect(); if (!KEEP_MIC) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } await this.ctx.close(); } catch (e) { console.warn(e); }
    let n = 0; chunks.forEach(c => n += c.length);
    const all = new Float32Array(n); let o = 0; chunks.forEach(c => { all.set(c, o); o += c.length; });
    const ratio = rate / 16000, outN = Math.floor(n / ratio), pcm = new Int16Array(outN);
    let peak = 0;
    for (let i = 0; i < outN; i++) {
      const a = Math.floor(i * ratio), b = Math.min(n, Math.floor((i + 1) * ratio)); let s = 0;
      for (let j = a; j < b; j++) s += all[j];
      s = b > a ? s / (b - a) : 0; peak = Math.max(peak, Math.abs(s));
      pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
    }
    const secs = outN / 16000;
    if (secs < 0.3) throw new AppErr('要按住不放再说话，说完再松开', '只录到 ' + secs.toFixed(2) + ' 秒');
    if (peak < 0.008) throw new AppErr('没录到声音，检查麦克风有没有被别的 APP 占用或被静音', '最大音量 ' + peak.toFixed(4));
    const h = new DataView(new ArrayBuffer(44)), W = (p, s) => { for (let i = 0; i < s.length; i++) h.setUint8(p + i, s.charCodeAt(i)); };
    W(0, 'RIFF'); h.setUint32(4, 36 + pcm.byteLength, true); W(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
    h.setUint32(24, 16000, true); h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, pcm.byteLength, true);
    return new Blob([h, pcm], { type: 'audio/wav' });
  }
};
/* 按住说话：按下开始录，松开结束。h.done(wav) 处理录音，h.error(e) 显示原因 */
function bindHold(btn, h) {
  let down = false, starting = false, timer = null;
  const info = t => { if (h.info) h.info(t); };
  const setRec = on => { btn.classList.toggle('rec', on); btn.classList.remove('arming'); if (!on) btn.style.removeProperty('--lv'); };
  async function start(e) {
    if (btn.disabled || down || Rec.on) return;
    e.preventDefault(); down = true; starting = true; clearMsg();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    stopAudio();
    btn.classList.add('arming');   // 一按下就变样，让人知道按到了
    const t0 = Date.now();
    const slow = setTimeout(() => info('正在打开麦克风。如果浏览器上方或屏幕上弹出"是否允许使用麦克风"，请点"允许"。'), 500);
    try { await Rec.start(); } catch (err) { clearTimeout(slow); down = starting = false; btn.classList.remove('arming'); return h.error(err); }
    clearTimeout(slow); starting = false;
    if (!down) {   // 麦克风还没准备好手就松开了（第一次会弹出权限询问，手指一定会离开）
      btn.classList.remove('arming');
      try { await Rec.stop(); } catch (_) {}
      return h.error(new AppErr(Date.now() - t0 > 800 ? '麦克风已经允许了。现在按住按钮说话，说完再松开。' : '要按住不放再说话，说完再松开。', ''));
    }
    Rec.onLevel = v => btn.style.setProperty('--lv', Math.min(1, v * 4).toFixed(2));
    setRec(true); info('正在录音，说完松开。'); timer = setTimeout(end, 30000);
  }
  async function end() {
    if (!down) return; down = false; clearTimeout(timer);
    if (starting) return;
    setRec(false);
    try { const wav = await Rec.stop(); if (wav) await h.done(wav); } catch (err) { h.error(err); }
  }
  btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end);
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- Claude 翻译 ---------- */
const SYS = `你是土生土长的金边人，同时精通中文。用户是在柬埔寨做饮料自动贩卖机生意的中国男老板，不会高棉语。他会说一句中文，你要把它变成他能直接对本地员工开口说的高棉语。

翻译要求：
1. 用金边人日常口语，像本地老板当面跟员工说话那样自然、客气、简短。不要书面语、公文腔，不要报纸新闻用词，不要王室或僧侣用语。
2. 说话人是男性，听的人是员工，男女都有。绝对不要用 អូន 称呼员工（男人这样叫女员工像在叫女朋友）。称呼怎么用，照下面"称呼"那一条。
3. 下面"固定说法"里列出的词必须照用，不要换别的词。其他像零钱、钥匙这类词，用本地员工平时真正会说的说法，口语里常用的外来词可以用。
4. 一句话一个意思，句子尽量短。原话如果有歧义，按最可能的工作场景理解，并在 note 里用中文说明你是怎么理解的。
5. 如果原话不是一句要翻译的话（比如空的、乱码），km 留空，note 说明原因。
6. 忠实原话：不要添加原话里没有的意思，也不要漏掉原话里有的意思。

读音提示 ro 的写法（给只会汉语拼音的人看）：
- 按汉语拼音读：b d g 不送气（对应 ប៉/ព、ត/ទ、ក/គ），p t k 送气（ផ/ភ、ថ/ធ、ខ/ឃ），j = ច/ជ，q = ឆ/ឈ，ny = ញ，ng = ង，w = វ。
- 大写 B、D 表示内爆浊音 ប、ដ。
- e 表示央元音（像拼音"饿"的 e），ae 表示 ែ，双写元音表示长音，词尾 h 表示送气收尾，词尾 j 表示 ច 收尾。
- 词与词之间用空格，词内音节用连字符。
- 只能用普通英文字母 a 到 z、连字符和撇号。绝对不要用 ə、ɔ、ɛ、ɨ、ŋ 这类音标符号，不要加声调符号：央元音一律写 e。
- 这几个称呼的读音固定这样写：ប្អូន = b-oun，បង = Boong，ពូ = buu，មីង = miing。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：
{"km":"整句高棉文，不加句号","words":[{"km":"一个词","ro":"这个词的读音提示","zh":"这个词的中文意思"}],"ro":"整句读音提示","back":"把高棉语逐词直译回中文，让老板核对意思。称呼对方的词（ប្អូន、បង、ពូ、មីង）在句子里当「你」用时，写成 你（弟妹辈）、你（哥姐辈）、你（叔辈）、你（姨辈），不要只写弟妹、哥姐，words 里这个词的 zh 也这样写","note":"需要提醒老板的事，没有就留空","tip":"这句里中国人最难发准的一两个音，用中文讲嘴型舌位怎么摆，没有就留空"}
words 里每个词的 km 按顺序直接拼起来必须正好等于整句 km。`;

async function claude(system, user) {
  const key = S.set.clKey.trim();
  if (!key) throw new AppErr('还没填 Claude 密钥', '到"设置"里填上');
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: S.set.model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }) });
  } catch (e) { throw netErr('Claude ', e); }
  if (!r.ok) {
    let body = ''; try { body = await r.text(); } catch (e) {}
    let m = body; try { m = JSON.parse(body).error.message; } catch (e) {}
    const map = { 401: 'Claude 密钥不对', 403: 'Claude 拒绝了这个密钥', 404: 'Claude 找不到这个型号：' + S.set.model, 429: 'Claude 调用太频繁或超出额度', 529: 'Claude 服务器现在太忙，过一会儿再试', 500: 'Claude 服务器出错' };
    let zh = map[r.status] || 'Claude 翻译失败';
    if (/credit balance/i.test(m)) zh = 'Claude 账户余额不足';
    throw new AppErr(zh, 'HTTP ' + r.status + ' · ' + String(m).slice(0, 300));
  }
  const j = await r.json();
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}
async function translate(zh, prev, engine) {
  let user = '中文原话：' + zh;
  if (prev) user += `\n\n上一次的译法是「${prev}」，本地员工没听懂或者觉得不自然。请换一种更口语、更简单的说法。`;
  const raw = await llm(sysFull(), user, engine), who = engineName(engine);
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  let j;
  try { j = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new AppErr(who + '回的内容格式不对，再试一次', raw.slice(0, 300)); }
  if (!isKm(j.km)) throw new AppErr(j.note ? who + '没翻译：' + j.note : who + '没给出高棉文，再试一次', raw.slice(0, 300));
  let words = Array.isArray(j.words) ? j.words.filter(w => w && isKm(w.km)).map(w => ({ km: String(w.km).trim(), ro: String(w.ro || ''), zh: String(w.zh || '') })) : [];
  if (normKm(words.map(w => w.km).join('')) !== normKm(j.km)) words = [];   // 拆词对不上整句就不用，不硬凑
  return { zh, km: String(j.km).trim(), ro: String(j.ro || ''), words, back: String(j.back || ''), note: String(j.note || ''), tip: String(j.tip || ''), by: who, ts: Date.now(), uses: 0, staff: null };
}

/* ---------- 快速通道（翻译交给谷歌时用）：先只要一句高棉语马上念出来，逐词和读音随后再补 ---------- */
const plainRo = t => String(t || '').replace(/[əɨɯɤ]/g, 'e').replace(/ɔ/g, 'o').replace(/[ɛæ]/g, 'ae').replace(/ŋ/g, 'ng').replace(/ɲ/g, 'ny').replace(/[ʰːˈˌ]/g, '');
function jsonOf(raw, who) { try { return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch (e) { throw new AppErr(who + '回的内容格式不对，再试一次', raw.slice(0, 300)); } }
const SYS_HEAD = SYS.slice(0, SYS.indexOf('读音提示 ro 的写法'));   // 身份 + 翻译要求
const RO_RULES = SYS.slice(SYS.indexOf('读音提示 ro 的写法'), SYS.indexOf('只输出一个 JSON'));
const SYS_TAIL = SYS.slice(SYS.indexOf('只输出一个 JSON'));
/* 称呼：高棉语的"你"要看对方比自己大还是小。翻译页上选"对方是谁"，没选就不加称呼 */
const ADDRS = [['', '不加称呼'], ['y', '比我小'], ['o', '哥姐辈'], ['u', '叔辈'], ['a', '姨辈']];
const ADDR_RULE = {
  '': '原话里没有称呼就不要加称呼，直接省略主语。原话里叫了人，对比自己小的用 ប្អូន，对比自己大的用 បង。',
  y: '听话的人比说话人年纪小，是晚辈或年轻员工。口气平常、客气，不用敬语。用 ប្អូន 称呼对方：叫他做事、问他问题的句子，开头叫一声（本地人的习惯，显得客气），原话里的"你"也用这个词；只是在说一件事、跟他本人无关的句子，不要加称呼。',
  o: '听话的人比说话人大一些，或者是要客气对待的平辈。口气要客气，像跟同事商量；请他做事用 ជួយ…ផង 这类说法，不要用命令口气。用 បង 称呼对方：叫他做事、问他问题的句子，开头叫一声（本地人的习惯，显得客气），原话里的"你"也用这个词；只是在说一件事、跟他本人无关的句子，不要加称呼。',
  u: '听话的人是父母那一辈的男性长辈。整句都要用对长辈说话的礼貌说法：动词用敬语（比如"吃"用 ពិសា，不用 ញ៉ាំ、ស៊ី），请他做事用 សូម 或 ជួយ…ផង，不要用命令口气。用 ពូ 称呼对方：叫他做事、问他问题的句子，开头叫一声（本地人的习惯，显得客气），原话里的"你"也用这个词；只是在说一件事、跟他本人无关的句子，不要加称呼。',
  a: '听话的人是父母那一辈的女性长辈。整句都要用对长辈说话的礼貌说法：动词用敬语（比如"吃"用 ពិសា，不用 ញ៉ាំ、ស៊ី），请她做事用 សូម 或 ជួយ…ផង，不要用命令口气。用 មីង 称呼对方：叫他做事、问他问题的句子，开头叫一声（本地人的习惯，显得客气），原话里的"你"也用这个词；只是在说一件事、跟他本人无关的句子，不要加称呼。'
};
const glossText = () => (S.gloss || []).map(g => '- ' + g.zh + ' = ' + g.km).join('\n');
function trExtra() {
  const g = glossText();
  return (g ? '固定说法（这些词必须照下面的说；直译回中文时，这些词也按左边的中文写）：\n' + g + '\n\n' : '') + '称呼：' + (ADDR_RULE[S.set.addr] || ADDR_RULE['']) + '\n\n';
}
const sysHead = () => SYS_HEAD + trExtra();
const sysDetail = () => SYS_DETAIL + (glossText() ? '\n\n写 back 和 words 里的 zh 时，下面这些词按左边的中文写，不要换成别的意思：\n' + glossText() : '');
const sysFull = () => sysHead() + RO_RULES + SYS_TAIL;
const sysFast = () => sysHead() + '只输出翻好的那一句高棉文，不加句号，不要任何别的文字、解释、引号或读音。如果原话不是一句要翻译的话，只输出一个空格。';
const sysZhAudio = () => sysHead() + `这次他的中文是一段录音。先一字不差听写出他说的中文，再按上面的要求翻成高棉语。
只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：{"zh":"听到的中文原话","km":"整句高棉文，不加句号"}
如果录音里没有人说话或者完全听不清，zh 和 km 都留空。`;
const SYS_DETAIL = `你是土生土长的金边人，同时精通中文。下面是一句中文，和已经定下来的高棉语口语译文。不要改译文，只给它配上逐词拆分和读音，方便一个只会汉语拼音的中国人照着念、核对意思。

` + RO_RULES + `只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：
{"words":[{"km":"一个词","ro":"这个词的读音提示","zh":"这个词的中文意思"}],"ro":"整句读音提示","back":"把高棉语逐词直译回中文，让老板核对意思。称呼对方的词（ប្អូន、បង、ពូ、មីង）在句子里当「你」用时，写成 你（弟妹辈）、你（哥姐辈）、你（叔辈）、你（姨辈），不要只写弟妹、哥姐，words 里这个词的 zh 也这样写","note":"只有译文和中文原话意思有出入、或者这句话容易引起误会时才写，一句话说完；没有就留空","tip":"这句里中国人最难发准的一两个音，用中文讲嘴型舌位怎么摆，没有就留空"}
words 里每个词的 km 按顺序直接拼起来必须正好等于整句译文（空格不算）。`;
const SYS_KM_AUDIO = `你是精通高棉语和中文的口译员。录音里是一位柬埔寨员工对中国老板说的一句高棉语口语。老板做饮料自动贩卖机生意。

要求：
1. 先把听到的高棉语一字不差写成高棉文，再翻成自然、简短的中文口语，让老板一眼看懂。
2. 不要添加原话没有的内容。数字、金额、时间、地点、人名要准确保留。
3. 听不清、或者拿不准他说的是什么时，sure 填 false，zh 写你认为最可能的意思，note 用中文说明哪里拿不准。拿得准时 sure 填 true，note 留空。
4. 如果录音里没有人说话，km 和 zh 都留空。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：{"km":"听到的高棉文","zh":"中文意思","sure":true,"note":""}`;
const TR_V = 7;   // 翻译要求的版本号。改了翻译要求就加一，旧版本存下的句子会重新翻（员工听懂过的照旧用）
const trVer = () => { const t = glossText(); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return TR_V + '|' + h; };   // 固定说法表一改，版本也跟着变
const phraseKey = zh => normZh(zh) + (S.set.addr ? '@' + S.set.addr : '');
const fastOn = () => S.set.trEngine !== 'claude' && !!S.set.gKey;
const audioParts = async wav => [{ inlineData: { mimeType: 'audio/wav', data: await blobToB64(wav) } }, { text: '请听这段录音。' }];
function basePhrase(zh, km) { return { zh, km: String(km).trim(), ro: '', words: [], back: '', note: '', tip: '', by: '谷歌', ts: Date.now(), uses: 0, staff: null, v: trVer() }; }
async function quickKm(zh, prev) {
  let user = '中文原话：' + zh;
  if (prev) user += `\n\n上一次的译法是「${prev}」，本地员工没听懂或者觉得不自然。请换一种更口语、更简单的说法。`;
  const km = (await gGen(sysFast(), [{ text: user }], '翻译', true)).trim().replace(/^["'「“]+|["'」”。។]+$/g, '');
  if (!isKm(km)) throw new AppErr('谷歌没给出高棉文，再试一次', km.slice(0, 300));
  return km;
}
async function hearZh(wav) {   // 听中文录音，一步出中文原话和高棉语
  const j = jsonOf(await gGen(sysZhAudio(), await audioParts(wav), '听和翻译'), '谷歌');
  return { zh: String(j.zh || '').trim(), km: String(j.km || '').trim() };
}
async function hearKm(wav) {   // 听高棉语录音，一步出高棉文和中文意思
  const j = jsonOf(await gGen(SYS_KM_AUDIO, await audioParts(wav), '听和翻译'), '谷歌');
  return { km: String(j.km || '').trim(), zh: String(j.zh || '').trim(), sure: j.sure !== false, note: String(j.note || '') };
}
async function fillDetail(p) {
  const j = jsonOf(await gGen(sysDetail(), [{ text: '中文原话：' + p.zh + '\n高棉语译文：' + p.km }], '逐词拆分'), '谷歌');
  let words = Array.isArray(j.words) ? j.words.filter(w => w && isKm(w.km)).map(w => ({ km: String(w.km).trim(), ro: plainRo(w.ro), zh: String(w.zh || '') })) : [];
  if (normKm(words.map(w => w.km).join('')) !== normKm(p.km)) words = [];   // 拆词对不上整句就不用，不硬凑
  p.words = words; p.ro = plainRo(j.ro); p.back = String(j.back || ''); p.note = String(j.note || ''); p.tip = String(j.tip || '');
  return p;
}
async function hearWord(wav, zh, old) {   // 员工说一个词，写成高棉文
  const t = await gGen(`你是听写员。录音里一位柬埔寨人说了一个高棉语的词或短语${zh ? '，意思是「' + zh + '」' : ''}。${old ? '之前用的说法是「' + old + '」，他认为不合适，现在说的是他们平时的说法。' : ''}把他说的一字不差写成高棉文。只输出这个高棉文的词，不要翻译、不要解释、不要加标点。如果没有人说话或者完全听不清，只输出一个空格。`, await audioParts(wav), '听写', true);
  return isKm(t) ? t.trim().replace(/[។\s]+$/, '') : '';
}
function setGloss(zh, km) { S.gloss = (S.gloss || []).filter(g => g.zh !== zh); S.gloss.push({ zh, km }); save(); }
const HOLD_CSS = 'touch-action:none;user-select:none;-webkit-user-select:none';
function wordCapture(box, o) {   // o: { zh 中文词, old 原来的说法, done() 存好以后, cancel() }
  let heard = '';
  const st = t => { const e = box.querySelector('.fixst'); if (e) e.textContent = t || ''; };
  function draw(msg) {
    const zh = (box.querySelector('.fixzh') || {}).value;
    box.innerHTML = `<div style="margin-top:10px;padding:12px;border-radius:14px;background:rgba(127,127,127,.16)"><p><b>改固定说法</b>${o.old ? '（原来说的是 <span class="km" lang="km">' + esc(o.old) + '</span>）' : ''}</p>
      <label class="f">中文词</label><input class="fixzh" autocomplete="off" style="color:var(--ink)" placeholder="比如：钱箱" value="${esc(zh != null ? zh : (o.zh || ''))}">
      ${heard ? `<p class="km" lang="km" style="font-size:30px;font-weight:600;margin-top:8px">${esc(heard)}</p><p style="font-size:13px;opacity:.85">请员工看一下上面这个词写得对不对。</p>
        <div class="btns"><button class="b pri" data-fx="save">对，存下来</button><button class="b" data-fx="play">再念一遍</button><button class="b" data-fx="redo">不对，重说</button><button class="b" data-fx="cancel">取消</button></div>`
      : `<div class="btns"><button class="b pri fixrec" style="${HOLD_CSS}">员工按住说这个词</button><button class="b" data-fx="cancel">取消</button></div>`}
      <p class="fixst" style="min-height:22px;font-size:14px;margin-top:6px">${esc(msg || '')}</p></div>`;
    const rec = box.querySelector('.fixrec');
    if (rec) bindHold(rec, { error: e => st((e.zh || '出错了') + (e.detail ? '\u3000' + e.detail : '')), info: t => st(t), done: async wav => {
      st('正在听…');
      heard = await hearWord(wav, box.querySelector('.fixzh').value.trim(), o.old);
      if (!heard) return draw('没听出来，请员工离手机近一点再说一次。');
      draw(''); say(heard).catch(console.warn);
    } });
    box.style.scrollMarginTop = '76px'; box.scrollIntoView({ block: 'start' });   // 面板挪到屏幕上半截，别被底下的话筒栏挡住
  }
  box.onclick = e => {
    const b = e.target.closest('[data-fx]'); if (!b) return; e.stopPropagation();
    const fx = b.dataset.fx;
    if (fx === 'play') say(heard).catch(console.warn);
    else if (fx === 'redo') { heard = ''; draw(''); }
    else if (fx === 'cancel') { box.innerHTML = ''; box.onclick = null; if (o.cancel) o.cancel(); }
    else if (fx === 'save') {
      const zh = box.querySelector('.fixzh').value.trim();
      if (!zh) return st('先在上面填这个词的中文。');
      setGloss(zh, heard); box.innerHTML = ''; box.onclick = null; if (o.done) o.done(zh, heard);
    }
  };
  draw('');
}
const LOADING = new WeakSet(); let trRefresh = null;
function addDetail(p) {   // 不挡着出声：后台补逐词和读音，补好了刷新一下翻译页
  if (LOADING.has(p)) return;
  LOADING.add(p);
  fillDetail(p).catch(e => console.warn('逐词和读音没取到', e)).then(async () => {
    LOADING.delete(p);
    try { await idb('phrases', 'readwrite', s => s.put(p, p.k || normZh(p.zh))); } catch (e) { console.warn(e); }
    save(); if (TAB === 'tr' && trRefresh) trRefresh(p);
  });
}

/* ---------- 句子卡片（翻译结果和学新句共用） ---------- */
let CUR = null;   // 当前屏幕上那张卡片对应的句子
function wordsOf(p) { return p.words && p.words.length ? p.words : [{ km: p.km, ro: p.ro, zh: p.zh }]; }
function cardHTML(p, extra) {
  const ws = wordsOf(p);
  return `<article class="card ph">
    <p class="zh">${esc(p.zh)}</p>
    <p class="km" lang="km">${ws.length > 1 ? ws.map((w, i) => `<span class="w" data-act="word" data-i="${i}">${esc(w.km)}</span>`).join('') : esc(p.km)}</p>
    <p class="ro">${esc(p.ro)}</p>
    <div class="btns">
      <button class="b pri" data-act="play">播放</button>
      <button class="b" data-act="slow">慢速</button>
      ${ws.length > 1 ? '<button class="b" data-act="words">逐词</button>' : ''}
      <button class="b ghost" data-act="voice">${S.set.voice === 'f' ? '女声' : '男声'}</button>
    </div>
    <div class="gloss" id="gloss">${ws.length > 1 ? '<span class="sub">点上面任何一个词，单独听它</span>' : ''}</div>
    ${extra || ''}
  </article>`;
}
function markWord(i) {
  view.querySelectorAll('.ph .w').forEach((el, k) => el.classList.toggle('on', k === i));
  const g = $('#gloss'); if (!g || !CUR) return;
  const w = wordsOf(CUR)[i];
  g.innerHTML = w ? `<b lang="km">${esc(w.km)}</b>\u3000${esc(w.ro)}\u3000${esc(w.zh)}${TAB === 'tr' && wordsOf(CUR).length > 1 ? `\u3000<button class="lk" data-act="fixWord" data-i="${i}" style="padding:0">这个词不对</button>` : ''}` : '';
}
const cardActs = {
  play: () => say(CUR.km),
  slow: () => say(CUR.km, { slow: true }),
  words: () => sayWords(wordsOf(CUR), markWord),
  word: b => { const i = +b.dataset.i; markWord(i); return say(wordsOf(CUR)[i].km, { slow: true }); },
  voice: b => { S.set.voice = S.set.voice === 'f' ? 'm' : 'f'; save(); b.textContent = S.set.voice === 'f' ? '女声' : '男声'; return say(CUR.km); }
};

/* 点击分发：按钮上写 data-act，各页面提供自己的动作表 */
let ACTS = {};
view.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const fn = ACTS[b.dataset.act] || cardActs[b.dataset.act]; if (!fn) return;
  clearMsg();
  try { await fn(b, e); } catch (err) { showErr(err); }
});

/* ---------- 页面切换 ---------- */
let TAB = 'tr';
function go(tab) {
  stopAudio(); if (Rec.on) Rec.stop().catch(() => {});
  TAB = tab; document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  ({ tr: viewTr, game: viewGame, set: viewSet })[tab]();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
function keyWarn() {
  const miss = missingKeys();
  return miss.length ? `<div class="warn">还没填${miss.join('和')}。<button class="b" data-act="toSet" style="margin-top:8px">去设置里填</button></div>` : '';
}

/* ================= 功能一：对话翻译（双向，按住说话） ================= */
const MIC_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SYS_KM = `你是精通高棉语和中文的口译员。下面是一位柬埔寨员工对中国老板说的一句高棉语口语，是语音识别出来的文字，可能有同音错字、漏字、断词错误。老板做饮料自动贩卖机生意。

要求：
1. 先结合上下文纠正明显的识别错误，再翻成自然、简短的中文口语，让老板一眼看懂。
2. 不要添加原话没有的内容。数字、金额、时间、地点、人名要准确保留。
3. 如果这段文字不通顺，你拿不准他说的是什么，sure 填 false，zh 写你认为最可能的意思，note 用中文说明哪里拿不准。拿得准时 sure 填 true，note 留空。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：{"zh":"中文意思","sure":true,"note":""}`;
async function kmToZh(km) {
  const raw = await llm(SYS_KM, '识别出来的高棉语：' + km);
  let j; try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch (e) { throw new AppErr(engineName() + '回的内容格式不对，再试一次', raw.slice(0, 300)); }
  if (!j.zh) throw new AppErr(engineName() + '没给出中文意思，再试一次', raw.slice(0, 300));
  return { zh: String(j.zh), sure: j.sure !== false, note: String(j.note || '') };
}
function viewTr() {
  let log = (S.log || []).slice(), active = -1, pend = null, err = null;
  for (let i = log.length - 1; i >= 0; i--) if (log[i].t === 'me') { active = i; break; }
  view.innerHTML = `${keyWarn()}<div id="msg"></div><div class="chat" id="chat"></div>
    <div class="dock"><div class="in">
      <form class="typed" id="typed" hidden><input id="zhIn" placeholder="打中文，比如：去给机器补饮料" autocomplete="off"><button class="b pri">翻译</button></form>
      <div class="tools" style="gap:6px"><select class="pill" id="addrSel" aria-label="对方是谁，决定用什么称呼" style="padding:6px 8px;max-width:128px">${ADDRS.map(a => `<option value="${a[0]}" ${a[0] === (S.set.addr || '') ? 'selected' : ''}>对方：${a[1]}</option>`).join('')}</select><button class="pill" data-act="phr">常用句</button><button class="pill" data-act="kb">打字</button><button class="pill" data-act="clr">清空对话</button></div>
      <div class="talk2">
        <div class="talker"><button class="hold kmb" id="hKm" aria-label="员工按住说高棉语">${MIC_SVG}</button><span class="l1 km" lang="km">ខ្មែរ</span><span class="l2">员工按住说高棉语</span></div>
        <div class="talker"><button class="hold zhb" id="hZh" aria-label="我按住说中文">${MIC_SVG}</button><span class="l1">中文</span><span class="l2">我按住说，松开翻译</span></div>
      </div>
    </div></div>`;
  const chat = $('#chat');
  const fit = () => { chat.style.paddingBottom = (view.querySelector('.dock').offsetHeight + 24) + 'px'; };   // 底下那块有多高，对话就让出多高，免得最后一个气泡的按钮被挡住
  const addrSel = $('#addrSel');
  const paintAddr = () => { const on = !!S.set.addr; addrSel.style.background = on ? 'var(--pri)' : ''; addrSel.style.color = on ? '#fff' : ''; };   // 选了称呼就变蓝，提醒现在每句都会带称呼
  addrSel.addEventListener('change', () => { S.set.addr = addrSel.value; save(); paintAddr(); });
  paintAddr();
  const persist = () => { S.log = log.slice(-40); save(); };
  const setErr = (side, e) => { console.error(e); pend = null; err = { side, zh: e instanceof AppErr ? e.zh : '程序出错了', detail: e instanceof AppErr ? e.detail : String(e && (e.stack || e.message) || e) }; render(); };
  function bubble(x, i) {
    if (x.t === 'st') return `<div class="bub st"><p class="who">员工说</p><p class="km" lang="km">${esc(x.km)}</p><p class="bz">${esc(x.zh)}</p>${x.sure === false ? `<p class="unsure">机器可能没听准，最好请他再说一遍。${esc(x.note)}</p>` : (x.note ? `<p class="bnote">${esc(x.note)}</p>` : '')}</div>`;
    const p = x.p, ws = wordsOf(p);
    if (i !== active) return `<button class="bub me cmp" data-act="sel" data-i="${i}"><span class="bz">${esc(p.zh)}</span><span class="km" lang="km">${esc(p.km)}</span></button>`;
    return `<div class="bub me ph"><p class="who">我说${p.by ? '（' + esc(p.by) + '翻译）' : ''}${p.staff === 'ok' ? '<span class="tag">员工听懂过</span>' : ''}</p><p class="bz">${esc(p.zh)}</p>
      <p class="km" lang="km">${ws.length > 1 ? ws.map((w, k) => `<span class="w" data-act="word" data-i="${k}">${esc(w.km)}</span>`).join('') : esc(p.km)}</p>
      <p class="br">${p.ro ? esc(p.ro) : LOADING.has(p) ? '正在准备读音和逐词…' : ''}</p>
      <div class="btns"><button class="b pri" data-act="play">播放</button><button class="b" data-act="slow">慢速</button>${ws.length > 1 ? '<button class="b" data-act="words">逐词</button>' : ''}<button class="b" data-act="show">放大</button><button class="b" data-act="voice">${S.set.voice === 'f' ? '女声' : '男声'}</button></div>
      <div class="gloss" id="gloss"></div><div id="fixBox"></div>
      ${p.back ? `<p class="bnote">直译回中文：${esc(p.back)}</p>` : ''}${p.note ? `<p class="bnote">提醒：${esc(p.note)}</p>` : ''}${p.tip ? `<p class="bnote">发音：${esc(p.tip)}</p>` : ''}
      <div class="btns"><button class="lk" data-act="staffOk">员工听懂了</button><button class="lk" data-act="retry">没听懂，换个说法</button>${!p.ro && !p.back && !LOADING.has(p) && fastOn() ? '<button class="lk" data-act="detail">补上读音和逐词</button>' : ''}</div></div>`;
  }
  function render() {
    const items = log.map(bubble);
    if (pend) items.push(`<div class="bub ${pend.side} pend">${pend.km ? `<p class="km" lang="km">${esc(pend.km)}</p>` : ''}<p>${esc(pend.text)}</p></div>`);
    if (err) items.push(`<div class="bub ${err.side} err"><b>${esc(err.zh)}</b>${err.detail ? `<small>${esc(err.detail)}</small>` : ''}</div>`);
    chat.innerHTML = items.join('') || `<div class="empty"><p class="big">两个人对着手机说话</p><p>你按住蓝色按钮说中文，松开后手机用高棉语念给员工听。</p><p>员工按住橙色按钮说高棉语，松开后屏幕显示中文。</p></div>`;
    CUR = active >= 0 && log[active] ? log[active].p : null; fit();
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  }
  trRefresh = p => { if (log.some(x => x.p === p)) render(); };
  async function sendZh(zh, prev, at, km0) {   // km0：录音那一步已经顺手翻好的高棉语
    zh = zh.trim(); if (!zh) return;
    const k = phraseKey(zh);
    pend = { side: 'me', text: '正在翻译：' + zh }; err = null; render();
    try {
      let p = prev ? null : await idb('phrases', 'readonly', s => s.get(k)), fresh = false;
      if (p && p.v !== trVer() && p.staff !== 'ok') p = null;
      if (!p) {
        if (fastOn()) { p = basePhrase(zh, km0 && isKm(km0) ? km0 : await quickKm(zh, prev)); fresh = true; }
        else { p = await translate(zh, prev); p.v = trVer(); }
      }
      p.uses = (p.uses || 0) + 1; p.last = Date.now(); p.k = k;
      await idb('phrases', 'readwrite', s => s.put(p, k));
      if (at != null) log[at] = { t: 'me', p }; else log.push({ t: 'me', p });
      active = at != null ? at : log.length - 1;
      if (fresh) addDetail(p);
      pend = null; persist(); render();
      await say(p.km);
    } catch (e) { setErr('me', e); }
  }
  async function sendKm(wav) {
    pend = { side: 'st', text: '正在听他说的话…' }; err = null; render();
    try {
      if (fastOn() && !useAz()) {   // 谷歌一步到位：边听边翻
        const d = await hearKm(wav);
        if (!d.km && !d.zh) throw new AppErr('没听出高棉语，请他离手机近一点再说一次', '');
        log.push({ t: 'st', km: d.km, zh: d.zh || '（没翻出来）', sure: d.sure && !!d.zh, note: d.note }); pend = null; persist(); render();
        return;
      }
      const r = await stt(wav, 'km-KH');
      if (!r.ok) throw new AppErr('没听出高棉语，请他离手机近一点再说一次', '接口返回：' + r.status);
      pend = { side: 'st', text: '正在翻成中文…', km: r.text }; render();
      const j = await kmToZh(r.text);
      log.push({ t: 'st', km: r.text, zh: j.zh, sure: j.sure, note: j.note }); pend = null; persist(); render();
    } catch (e) { setErr('st', e); }
  }
  bindHold($('#hZh'), { error: e => setErr('me', e), info: t => { pend = { side: 'me', text: t }; err = null; render(); }, done: async wav => {
    const fast = fastOn() && !useAz();
    pend = { side: 'me', text: fast ? '正在听并翻译…' : '正在听写…' }; err = null; render();
    try {
      if (fast) { const d = await hearZh(wav); if (!d.zh) throw new AppErr('没听清你说的中文，离手机近一点再说一次', ''); await sendZh(d.zh, null, null, d.km); }
      else { const r = await stt(wav, 'zh-CN'); if (!r.ok) throw new AppErr('没听清你说的中文，离手机近一点再说一次', '接口返回：' + r.status); await sendZh(r.text); }
    } catch (e) { setErr('me', e); }
  } });
  bindHold($('#hKm'), { error: e => setErr('st', e), info: t => { pend = { side: 'st', text: t }; err = null; render(); }, done: sendKm });
  $('#typed').addEventListener('submit', e => { e.preventDefault(); const v = $('#zhIn').value; $('#zhIn').value = ''; sendZh(v); });
  ACTS = {
    toSet: () => go('set'),
    sel: b => { active = +b.dataset.i; render(); return say(log[active].p.km); },
    show: () => openShow(CUR.km),
    staffOk: async () => { CUR.staff = 'ok'; await idb('phrases', 'readwrite', s => s.put(CUR, CUR.k || normZh(CUR.zh))); persist(); render(); },
    retry: () => sendZh(CUR.zh, CUR.km, active),
    detail: () => { addDetail(CUR); render(); },
    fixWord: b => { const w = wordsOf(CUR)[+b.dataset.i], p = CUR, at = active; stopAudio();
      wordCapture($('#fixBox'), { zh: w.zh, old: w.km, done: () => { p.staff = null; sendZh(p.zh, null, at); } }); },
    kb: () => { const f = $('#typed'); f.hidden = !f.hidden; fit(); if (!f.hidden) $('#zhIn').focus(); },
    clr: b => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '再点一次清空'; return; } log = []; active = -1; err = null; persist(); delete b.dataset.sure; b.textContent = '清空对话'; render(); },
    phr: async () => {
      const all = (await idb('phrases', 'readonly', s => s.getAll())) || [];
      all.sort((a, b) => (b.last || b.ts) - (a.last || a.ts));
      $('#phr').innerHTML = all.length ? all.map(p => `<li><button class="main" data-k="${esc(p.k || normZh(p.zh))}"><span>${esc(p.zh)}${p.staff === 'ok' ? '<span class="tag">员工听懂过</span>' : ''}</span><span class="km" lang="km">${esc(p.km)}</span></button><button class="x" data-k="${esc(p.k || normZh(p.zh))}">删除</button></li>`).join('') : '<li class="sub">还没有。翻译过的句子会自动存到这里，下次点一下直接播，不用联网。</li>';
      $('#sheet').classList.add('on');
    }
  };
  $('#phr').onclick = async e => {
    const m = e.target.closest('.main'), x = e.target.closest('.x');
    if (m) { $('#sheet').classList.remove('on'); const p = await idb('phrases', 'readonly', s => s.get(m.dataset.k)); if (p) sendZh(p.zh); }
    if (x) { if (x.dataset.sure) { await idb('phrases', 'readwrite', s => s.delete(x.dataset.k)); x.closest('li').remove(); } else { x.dataset.sure = 1; x.textContent = '再点一次删除'; } }
  };
  render();
}
$('#sheetClose').onclick = () => $('#sheet').classList.remove('on');
/* 放大给员工看 */
let showKm = '';
function openShow(km) { showKm = km; $('#showKm').textContent = km; $('#show').classList.add('on'); say(km).catch(console.warn); }
$('#showPlay').onclick = () => say(showKm).catch(console.warn);
$('#showSlow').onclick = () => say(showKm, { slow: true }).catch(console.warn);
$('#showClose').onclick = () => { stopAudio(); $('#show').classList.remove('on'); };

/* ================= 功能二：闯关 ================= */
const UNIT = {}; const ITEM = {};
COURSE.forEach(u => { UNIT[u.id] = u; u.items.forEach(it => { it.words = it.w ? it.w.map(w => ({ km: w[0], ro: w[1], zh: w[2] })) : null; ITEM[it.km] = it; }); });
const EARS = {}; EAR.forEach(e => EARS[e.id] = e);
const REV_GAP = [1, 2, 4, 7, 15, 30];

function nodeDone(n) { return n.t === 'unit' ? !!(S.units[n.id] && S.units[n.id].done) : n.t === 'ear' ? !!(S.ear[n.id] && S.ear[n.id].done) : !!(S.boss[n.id] && S.boss[n.id].pass); }
function nodeOpen(i) {
  const n = PATH[i];
  if (n.t === 'boss') return n.units.every(u => S.units[u] && S.units[u].done);
  for (let k = 0; k < i; k++) if (PATH[k].t !== 'boss' && !nodeDone(PATH[k])) return false;   // 真人验证关不卡后面的进度
  return true;
}
function tickStreak() {
  const t = day(); if (S.streak.last === t) return;
  S.streak.days = S.streak.last === dayPlus(-1) ? S.streak.days + 1 : 1; S.streak.last = t; save();
}
function dueList() { const t = day(); return Object.keys(S.rev).filter(k => ITEM[k] && S.rev[k].due <= t); }
function learnedItems() { const a = []; COURSE.forEach(u => { if (S.units[u.id] && S.units[u.id].done) a.push(...u.items); }); return a; }

function viewGame() {
  CUR = null;
  const doneUnits = COURSE.filter(u => S.units[u.id] && S.units[u.id].done).length;
  const streak = (S.streak.last === day() || S.streak.last === dayPlus(-1)) ? S.streak.days : 0;
  const due = dueList().length, m = S.mission;
  let unitNo = 0;
  view.innerHTML = `${keyWarn()}<div id="msg"></div>
    <div class="stat"><div><b>${streak}</b>连续学习天数</div><div><b>${doneUnits} / ${COURSE.length}</b>已过单元</div></div>
    ${m && m.state === 'todo' ? `<div class="card"><p class="sub">今天的真人任务：找机会对本地人说一次</p><p class="big">${esc(m.zh)}</p><p class="km" lang="km" style="font-size:26px">${esc(m.km)}</p>
      <div class="btns"><button class="b pri" data-act="mPlay">先听一遍</button><button class="b" data-act="mOk">说了，对方听懂了</button><button class="b" data-act="mNo">说了，没听懂</button></div></div>` : ''}
    ${due ? `<button class="node open" data-act="review"><span class="n">${due}</span><span><b>今日复习</b><small>以前学过、今天该再听一遍的句子</small></span></button>` : ''}
    <h2 class="h2">关卡</h2>
    <ol class="path">${PATH.map((n, i) => {
      const done = nodeDone(n), open = nodeOpen(i), cls = done ? 'done' : open ? 'open' : 'lock';
      if (n.t === 'unit') { const u = UNIT[n.id]; unitNo++; return `<li><button class="node ${cls}" data-act="unit" data-id="${n.id}" ${open ? '' : 'disabled'}><span class="n">${done ? '✓' : unitNo}</span><span><b>${esc(u.title)}</b><small>${esc(u.sub)}</small></span></button></li>`; }
      if (n.t === 'ear') { const e = EARS[n.id]; return `<li><button class="node ear ${cls}" data-act="ear" data-id="${n.id}" ${open ? '' : 'disabled'}><span class="n">${done ? '✓' : '耳'}</span><span><b>练耳朵：${esc(e.title)}</b><small>两个容易听混的音，听出是哪一个</small></span></button></li>`; }
      const bs = S.boss[n.id];
      return `<li><button class="node boss ${cls}" data-act="boss" data-id="${n.id}" ${open ? '' : 'disabled'}><span class="in"><span class="n">${done ? '✓' : '人'}</span><span><b>${esc(n.title)}</b><small>${bs ? (bs.pass ? '已通过 ' : '上次没过 ') + bs.at : open ? '找一位本地员工，把学过的句子说给他听' : '学完前面三个单元后开放'}</small></span></span></button></li>`;
    }).join('')}</ol>
    <button class="b ghost wide" data-act="legend">读音提示怎么看</button>`;
  ACTS = {
    toSet: () => go('set'),
    unit: b => startUnit(UNIT[b.dataset.id]),
    ear: b => startEar(EARS[b.dataset.id]),
    boss: b => startBoss(PATH.find(n => n.id === b.dataset.id)),
    review: () => startReview(),
    legend: () => viewLegend(),
    mPlay: () => say(m.km),
    mOk: () => endMission('ok'), mNo: () => endMission('no')
  };
}
function endMission(r) {
  const m = S.mission; S.missionLog.push({ km: m.km, r, at: day() }); m.state = r;
  if (r === 'no') S.rev[m.km] = { box: 0, due: day() };
  tickStreak(); save(); viewGame();
}
function viewLegend() {
  view.innerHTML = `<button class="back2" data-act="home">‹ 回关卡</button>
    <div class="card flat"><p class="big">读音提示怎么看</p>
    <div class="tips"><p>蓝色那行读音提示按汉语拼音读：b d g 不送气，p t k 送气，j q 和拼音一样。</p><p>它只是拐杖，写不出高棉语真正的声音。以听到的标准音为准，多用"慢速"和"逐词"。</p>
    ${Object.values(TIPS).map(t => `<p>${esc(t)}</p>`).join('')}</div></div>`;
  ACTS = { home: viewGame };
}
function prefetch(items) {
  if (useAz() ? !S.set.azKey : !S.set.gKey) return;
  items.reduce((p, it) => p.then(() => ttsBuf(it.km)).catch(e => console.warn('预取失败', it.km, e)), Promise.resolve());
}
function progHTML(n, on) { let s = '<div class="prog">'; for (let i = 0; i < n; i++) s += `<i class="${i < on ? 'on' : ''}"></i>`; return s + '</div>'; }
function head(title, sub) { return `<button class="back2" data-act="home">‹ 回关卡</button><p class="big">${esc(title)}</p><p class="sub" style="margin-bottom:12px">${esc(sub)}</p>`; }

/* --- 单元：学新句 → 听音选义 → 开口 --- */
function startUnit(u) { prefetch(u.items); unitLearn(u, 0); }
function unitLearn(u, i) {
  const it = u.items[i]; CUR = it;
  const tips = (it.tip || []).map(k => TIPS[k]).filter(Boolean);
  view.innerHTML = `${head(u.title, '第一步：先听熟。每句多听几遍，听不清就用慢速和逐词。')}${progHTML(u.items.length, i + 1)}<div id="msg"></div>
    ${cardHTML(it, tips.length ? `<div class="tips">${tips.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : '')}
    <div class="btns">${i > 0 ? '<button class="b" data-act="prev">上一句</button>' : ''}<button class="b blue" data-act="next" style="flex:1">${i < u.items.length - 1 ? '下一句' : '都听熟了，开始听音选义'}</button></div>`;
  ACTS = { home: viewGame, prev: () => unitLearn(u, i - 1),
    next: () => i < u.items.length - 1 ? unitLearn(u, i + 1) : runQuiz({ title: u.title, sub: '第二步：只听声音，选出意思。连续答对才算过，答错从头数。', items: u.items, pool: u.items, need: Math.min(u.items.length, 10), back: () => unitLearn(u, 0), done: () => unitSpeak(u) }) };
  say(it.km).catch(showErr);
}

/* 听音选义。need 有值 = 要连续答对 need 题；没有 = 每句过一遍（复习用） */
function runQuiz(o) {
  let combo = 0, queue = [], last = null, idx = 0; const results = {};
  const fill = () => { let s = shuffle(o.items); if (s.length > 1 && s[0] === last) s.push(s.shift()); queue.push(...s); };
  if (!o.need) queue.push(...o.items);
  function ask() {
    if (o.need) { if (!queue.length) fill(); } else if (!queue.length) return o.done(results);
    const it = queue.shift(); last = it; idx++; CUR = null; window.__km.q = it;
    const others = shuffle(o.pool.filter(x => x.zh !== it.zh)).slice(0, 3);
    const opts = shuffle([it, ...others]);
    view.innerHTML = `${head(o.title, o.sub)}${o.need ? progHTML(o.need, combo) : `<p class="sub">还剩 ${queue.length + 1} 句</p>`}<div id="msg"></div>
      <div class="card"><p class="sub">听到的是哪个意思？</p><div class="btns"><button class="b pri" data-act="again">再听一遍</button><button class="b" data-act="slowq">慢速</button></div>
      <div class="opts">${opts.map((x, k) => `<button class="b" data-act="pick" data-k="${k}">${esc(x.zh)}</button>`).join('')}</div><div id="after"></div></div>`;
    let answered = false;
    ACTS = { home: viewGame, again: () => say(it.km), slowq: () => say(it.km, { slow: true }),
      pick: b => {
        if (answered) return; answered = true;
        const right = opts[+b.dataset.k] === it;
        view.querySelectorAll('.opts .b').forEach((el, k) => { el.disabled = true; if (opts[k] === it) el.classList.add('ok'); });
        if (!right) b.classList.add('bad');
        if (!(it.km in results)) results[it.km] = right;
        if (right) { combo++; if (o.need && combo >= o.need) { tickStreak(); return setTimeout(() => o.done(results), 600); } return setTimeout(ask, 650); }
        combo = 0; if (o.need) queue.splice(Math.min(2, queue.length), 0, it);
        CUR = it;
        $('#after').innerHTML = `<div class="verdict no"><b>是这句：${esc(it.zh)}</b><p class="km" lang="km" style="font-size:28px">${esc(it.km)}</p><p class="sub">${esc(it.ro)}</p>${o.need ? '<p class="sub">连对数清零，这句等会儿还会再出现。</p>' : ''}
          <div class="btns"><button class="b" data-act="again">再听</button><button class="b" data-act="slowq">慢速</button><button class="b blue" data-act="cont">继续</button></div></div>`;
      },
      cont: ask };
    say(it.km).catch(showErr);
  }
  ask();
}

/* 开口：录音 → 微软高棉语听写 → 只判断"机器能不能听懂"，不打分 */
function judge(it, r) {
  const T = normKm(it.km), alts = r.alts.map(normKm);
  if (alts.includes(T)) return { level: 'ok' };
  const ws = wordsOf(it), heard = alts[0] || '';
  const hits = ws.map(w => heard.includes(normKm(w.km)));
  return { level: hits.some(Boolean) ? 'part' : 'no', hits, ws };
}
function speakPick(u) { const multi = u.items.filter(it => it.words && !/ៗ/.test(it.km)); return (multi.length >= 3 ? multi : u.items.filter(it => !/ៗ/.test(it.km))).slice().sort((a, b) => b.km.length - a.km.length).slice(0, 5); }
function unitSpeak(u) {
  const list = speakPick(u), res = {};
  const IDLE = '按住<br>说高棉语';
  function step(i) {
    if (i >= list.length) return unitDone(u, res);
    const it = list[i]; CUR = it;
    view.innerHTML = `${head(u.title, '第三步：开口。先听标准音，再自己说。这里只看机器能不能听懂你，不打分。')}${progHTML(list.length, i + 1)}
      ${cardHTML(it)}<section class="talk"><button class="mic" id="recBtn">${IDLE}</button><p class="st" id="st"></p></section><div id="msg"></div><div id="after"></div>
      <button class="b wide" data-act="skip">${i < list.length - 1 ? '下一句' : '完成'}</button>
      <p class="sub" style="margin-top:10px">机器听写不是百分之百准。它没听懂不一定是你说错，拿不准的留到"真人验证"让员工来判断。</p>`;
    ACTS = { home: viewGame,
      skip: () => { if (!res[it.km]) res[it.km] = 'skip'; step(i + 1); }
    };
    bindHold($('#recBtn'), { error: e => { $('#st').textContent = ''; showErr(e); }, info: t => { $('#st').textContent = t; }, done: async wav => {
        $('#st').textContent = '机器正在听…';
        const r = await stt(wav, 'km-KH'); $('#st').textContent = '';
        if (!r.ok) { if (res[it.km] !== 'ok') res[it.km] = 'no'; $('#after').innerHTML = `<div class="verdict no"><b>机器没听出高棉语</b><p class="sub">离手机近一点、周围安静一点，再说一次。（接口返回：${esc(r.status)}）</p></div>`; return; }
        const v = judge(it, r);
        if (v.level === 'ok' || res[it.km] !== 'ok') res[it.km] = v.level;
        $('#after').innerHTML = v.level === 'ok'
          ? `<div class="verdict ok"><b>机器听懂了</b><p class="sub">它听到的和这句一字不差。</p></div>`
          : `<div class="verdict ${v.level}"><b>${v.level === 'part' ? '机器只听懂了一部分' : '机器没听懂'}</b><p>机器听成了：<span class="km" lang="km" style="font-size:22px">${esc(r.text)}</span></p>
             ${v.ws.length > 1 ? `<p class="sub">听出来的词：${v.ws.filter((w, k) => v.hits[k]).map(w => esc(w.zh)).join('、') || '无'}；没听出来的：${v.ws.filter((w, k) => !v.hits[k]).map(w => esc(w.zh)).join('、')}</p>` : ''}
             <p class="sub">点上面的"慢速"或没听出来的那个词，对着再练，然后重录。</p></div>`;
      } });
  }
  step(0);
}
function unitDone(u, res) {
  const first = !(S.units[u.id] && S.units[u.id].done);
  S.units[u.id] = { done: true, at: day(), speak: res };
  u.items.forEach(it => { if (!S.rev[it.km]) S.rev[it.km] = { box: 0, due: dayPlus(1) }; });
  const cand = u.items.filter(it => it.words); const pick = cand.length ? cand[Math.floor(Math.random() * cand.length)] : u.items[0];
  if (first || !S.mission || S.mission.state !== 'todo') S.mission = { km: pick.km, zh: pick.zh, state: 'todo', at: day() };
  tickStreak(); save();
  const vals = Object.values(res), ok = vals.filter(v => v === 'ok').length;
  CUR = ITEM[S.mission.km];
  view.innerHTML = `<div class="card"><p class="big">「${esc(u.title)}」过关</p>
    <p>听音选义：连续答对，已通过。</p><p>开口：${vals.length} 句里机器听懂了 ${ok} 句。</p>
    <p class="sub" style="margin-top:8px">这些句子明天会出现在"今日复习"里。</p></div>
    <div class="card"><p class="sub">真人任务：找机会对本地人说一次</p><p class="big">${esc(S.mission.zh)}</p><p class="km" lang="km" style="font-size:28px">${esc(S.mission.km)}</p>
    <div class="btns"><button class="b pri" data-act="play">听一遍</button><button class="b" data-act="slow">慢速</button></div></div><div id="msg"></div>
    <button class="b blue wide" data-act="home">回关卡</button>`;
  ACTS = { home: viewGame };
}

/* --- 练耳朵 --- */
function startEar(e) {
  const NEED = 6;
  function compare(i) {
    if (i >= e.pairs.length) { S.ear[e.id] = { done: true, at: day() }; tickStreak(); save(); return viewGame(); }
    const p = e.pairs[i]; CUR = null;
    const side = (x, k) => `<div class="card"><p class="km" lang="km">${esc(x[0])}</p><p class="ro" style="color:var(--blue);font-weight:600">${esc(x[1])}</p><p>${esc(x[2])}</p><div class="btns" style="justify-content:center"><button class="b pri" data-act="p${k}">听</button><button class="b" data-act="s${k}">慢</button></div></div>`;
    view.innerHTML = `${head('练耳朵：' + e.title, `第 ${i + 1} / ${e.pairs.length} 组。先两边来回听，听出差别再开始测。`)}<div id="msg"></div>
      <div class="pair">${side(p.a, 'a')}${side(p.b, 'b')}</div><div class="tips" style="margin:14px 0">${esc(p.focus)}</div>
      <button class="b blue wide" data-act="test">听出差别了，开始测</button>`;
    ACTS = { home: viewGame, pa: () => say(p.a[0]), pb: () => say(p.b[0]), sa: () => say(p.a[0], { slow: true }), sb: () => say(p.b[0], { slow: true }), test: () => test(i, 0) };
    ttsBuf(p.a[0]).catch(showErr); ttsBuf(p.b[0]).catch(() => {});
  }
  function test(i, combo) {
    const p = e.pairs[i], ans = Math.random() < 0.5 ? 'a' : 'b'; let answered = false; window.__km.q = ans;
    view.innerHTML = `${head('练耳朵：' + e.title, `连续听对 ${NEED} 次过关，听错从头数。`)}${progHTML(NEED, combo)}<div id="msg"></div>
      <div class="card"><p class="sub">刚才播的是哪一个？</p><div class="btns"><button class="b pri" data-act="again">再听一遍</button></div>
      <div class="opts two">${['a', 'b'].map(k => `<button class="b" data-act="pick" data-k="${k}"><span class="km" lang="km">${esc(p[k][0])}</span>${esc(p[k][2])}</button>`).join('')}</div><div id="after"></div></div>`;
    ACTS = { home: viewGame, again: () => say(p[ans][0]),
      pa: () => say(p.a[0]), pb: () => say(p.b[0]),
      pick: b => {
        if (answered) return; answered = true;
        const right = b.dataset.k === ans;
        view.querySelectorAll('.opts .b').forEach(el => { el.disabled = true; if (el.dataset.k === ans) el.classList.add('ok'); });
        if (right) { if (combo + 1 >= NEED) return setTimeout(() => compare(i + 1), 600); return setTimeout(() => test(i, combo + 1), 600); }
        b.classList.add('bad');
        $('#after').innerHTML = `<div class="verdict no"><b>播的是「${esc(p[ans][2])}」</b><p class="sub">${esc(p.focus)}</p>
          <div class="btns"><button class="b" data-act="pa">听「${esc(p.a[2])}」</button><button class="b" data-act="pb">听「${esc(p.b[2])}」</button><button class="b blue" data-act="cont">重新数</button></div></div>`;
      },
      cont: () => test(i, 0) };
    say(p[ans][0]).catch(showErr);
  }
  compare(0);
}

/* --- 真人验证 --- */
function startBoss(n) {
  let pool = []; n.units.forEach(id => pool.push(...UNIT[id].items.filter(it => it.words)));
  const list = shuffle(pool).slice(0, 5), res = [];
  function intro() {
    view.innerHTML = `${head(n.title, '这一关由真人来判，机器不参与。')}
      <div class="card"><p>找一位本地员工或者任何本地人。</p><p>下面 5 句话，每句你<b>自己开口说</b>给他听，不要放录音。看他的反应或者让他照做，再按结果。</p>
      <p class="sub" style="margin-top:8px">5 句里有 4 句被听懂算通过。如果他说某句话本身就不对、本地人不这么说，按"这句话本身不对"，我会记下来。</p></div>
      <button class="b blue wide" data-act="go">人找到了，开始</button>`;
    ACTS = { home: viewGame, go: () => step(0) };
  }
  function step(i) {
    if (i >= list.length) return finish();
    const it = list[i]; CUR = it;
    view.innerHTML = `${head(n.title, `第 ${i + 1} / ${list.length} 句。可以先自己听一遍，再开口说给他听。`)}${progHTML(list.length, i + 1)}<div id="msg"></div>${cardHTML(it)}
      <div class="opts"><button class="b ok" data-act="r" data-r="ok">他听懂了</button><button class="b" data-act="r" data-r="no">他没听懂</button><button class="b" data-act="r" data-r="bad">他说这句话本身不对</button></div>`;
    ACTS = { home: viewGame, r: b => { res.push({ km: it.km, r: b.dataset.r }); if (b.dataset.r === 'bad') S.flags[it.km] = { zh: it.zh, at: day() }; if (b.dataset.r === 'no') S.rev[it.km] = { box: 0, due: day() }; save(); stopAudio(); step(i + 1); } };
  }
  function finish() {
    const ok = res.filter(x => x.r === 'ok').length, bad = res.filter(x => x.r === 'bad').length, pass = ok >= 4;
    S.boss[n.id] = { pass: pass || !!(S.boss[n.id] && S.boss[n.id].pass), at: day(), res }; tickStreak(); save();
    view.innerHTML = `<div class="card"><p class="big">${pass ? '真人验证通过' : '这次没过'}</p><p>${res.length} 句里他听懂了 ${ok} 句。</p>
      ${res.some(x => x.r === 'no') ? '<p class="sub">没听懂的句子已经放进"今日复习"。</p>' : ''}${bad ? `<p class="sub">有 ${bad} 句被指出本身不对，记在"设置"最下面，把它告诉 Claude 来改课程。</p>` : ''}</div>
      <button class="b blue wide" data-act="home">回关卡</button>`;
    ACTS = { home: viewGame };
  }
  intro();
}

/* --- 今日复习 --- */
function startReview() {
  const items = shuffle(dueList()).slice(0, 12).map(k => ITEM[k]);
  const pool = learnedItems(); prefetch(items);
  runQuiz({ title: '今日复习', sub: '只听声音，选出意思。答对的隔几天再考，答错的明天再来。', items, pool: pool.length >= 4 ? pool : COURSE[0].items,
    done: results => {
      let ok = 0;
      Object.keys(results).forEach(k => { const r = S.rev[k] || { box: 0 }; if (results[k]) { ok++; r.box = Math.min(r.box + 1, REV_GAP.length - 1); r.due = dayPlus(REV_GAP[r.box]); } else { r.box = 0; r.due = dayPlus(1); } S.rev[k] = r; });
      tickStreak(); save();
      view.innerHTML = `<div class="card"><p class="big">复习完了</p><p>${Object.keys(results).length} 句里第一次就听对 ${ok} 句。</p></div><button class="b blue wide" data-act="home">回关卡</button>`;
      ACTS = { home: viewGame };
    } });
}

/* ================= 设置 ================= */
async function viewSet() {
  CUR = null;
  let nAudio = '?', nPhr = '?';
  try { nAudio = await idb('audio', 'readonly', s => s.count()); nPhr = await idb('phrases', 'readonly', s => s.count()); } catch (e) { console.warn(e); }
  const flags = Object.keys(S.flags), az = useAz();
  const opt = (id, list) => `<select id="${id}">${list.map(m => `<option value="${m[0]}" ${S.set[id] === m[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</select>`;
  const HOLD = 'style="touch-action:none;user-select:none;-webkit-user-select:none"';
  view.innerHTML = `<div id="msg"></div>
    <div class="card flat"><p class="big">密钥</p><p class="sub">只存在这台手机的浏览器里。换手机或清浏览器数据后要重新填。</p>
      <label class="f" for="gKey">谷歌密钥（管念和听，也能管翻译）</label><input id="gKey" type="password" autocomplete="off" value="${esc(S.set.gKey)}">
      <label class="f" for="trEngine">翻译交给谁</label>${opt('trEngine', [['gemini', '谷歌 Gemini（用上面的谷歌密钥）'], ['claude', 'Claude（要另填 Claude 密钥）']])}
      <label class="f" for="clKey">Claude 密钥（选 Claude 翻译，或想对比两家时才需要）</label><input id="clKey" type="password" autocomplete="off" value="${esc(S.set.clKey)}">
      <label class="f" for="model">Claude 型号</label>${opt('model', [['claude-fable-5-2', 'Fable 5.2（默认，最强）'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5（更快）'], ['claude-haiku-5-5', 'Haiku 5.5（最快）']])}
    </div>
    <div class="card flat"><p class="big">声音和外观</p>
      <label class="f" for="voice">默认声音</label>${opt('voice', [['f', '女声'], ['m', '男声']])}
      ${az ? '' : `<label class="f" for="voiceF">女声用哪个嗓音</label><input id="voiceF" autocomplete="off" value="${esc(S.set.voiceF)}">
      <label class="f" for="voiceM">男声用哪个嗓音</label><input id="voiceM" autocomplete="off" value="${esc(S.set.voiceM)}">
      <p class="sub">名字照谷歌后台嗓音库里的写，例如 Fola、Rami。改了以后新句子才用新嗓音，以前存的声音不变。</p>`}
      ${S.set.voiceNote ? `<p class="res bad">${esc(S.set.voiceNote)}</p>` : ''}
      <label class="f" for="theme">外观</label>${opt('theme', [['light', '浅色'], ['dark', '深色']])}
      <label class="f" for="speech">念和听用哪家</label>${opt('speech', [['google', '谷歌'], ['azure', '微软（要有微软账号）']])}
      ${az ? `<label class="f" for="azKey">微软语音密钥</label><input id="azKey" type="password" autocomplete="off" value="${esc(S.set.azKey)}">
      <label class="f" for="azRegion">微软语音区域</label><input id="azRegion" autocomplete="off" autocapitalize="off" value="${esc(S.set.azRegion)}">` : ''}
    </div>
    <div class="card flat"><p class="big">一键自检</p><p class="sub">不用说话：APP 自己念一句、再把这句听回来、再翻译，一步步检查谷歌的念、听、翻是不是都真的通。会花一点点接口费用。</p>
      <div class="btns"><button class="b pri" data-act="selfTest">开始自检</button></div><div id="stRes"></div></div>
    <div class="card flat"><p class="big">逐项测试</p><p class="sub">每一项都是真的去调一次接口，失败会显示服务器返回的原话。</p>
      <div class="btns"><button class="b pri" data-act="tTts">测发音</button><button class="b" data-act="tCl">测翻译</button><button class="b" id="tSttBtn" ${HOLD}>测听写（按住说一句中文）</button><button class="b" id="tKmBtn" ${HOLD}>测高棉语听写（请员工按住说一句）</button></div>
      <div class="res" id="tRes"></div></div>
    <div class="card flat"><p class="big">两家翻译对比</p><p class="sub">同一句中文让谷歌和 Claude 各翻一次，放给本地人听，看谁翻得对。哪家的密钥没填就只出另一家。</p>
      <form class="typed" id="cmp" style="margin-top:10px"><input id="cmpIn" placeholder="打一句你平时会说的中文" autocomplete="off"><button class="b pri">对比</button></form><div id="cmpRes"></div></div>
    <div class="card flat"><p class="big">固定说法表</p><p class="sub">表里的词，翻译时一律照这里的说法。只在某个词真让员工听不懂或者误会时才加，个人说话习惯不用加。</p>
      <ul class="list" id="glossList" style="margin-top:10px">${(S.gloss || []).map((g, i) => `<li><span class="main"><span>${esc(g.zh)}</span><span class="km" lang="km">${esc(g.km)}</span></span><button class="x" data-act="gPlay" data-i="${i}">听</button><button class="x" data-act="gDel" data-i="${i}">删除</button></li>`).join('') || '<li class="sub">表是空的。</li>'}</ul>
      <div class="btns"><button class="b" data-act="gAdd">加一条</button></div><div id="gBox"></div></div>
    <div class="card flat"><p class="big">手机里存的东西</p><p>已存声音 ${nAudio} 段，常用句 ${nPhr} 句。</p>
      <div class="btns"><button class="b" data-act="dl">预先下载全部课程发音</button><button class="b ghost" data-act="wipe">清掉学习进度</button></div><div class="res" id="dlRes"></div></div>
    <div class="card flat"><p class="big">被本地人指出不对的句子</p>${flags.length ? `<ul class="list">${flags.map(k => `<li><span class="main"><span>${esc(S.flags[k].zh)}</span><span class="km" lang="km">${esc(k)}</span></span><span class="sub">${esc(S.flags[k].at)}</span></li>`).join('')}</ul><p class="sub">把这几句发给 Claude，让它改课程。</p>` : '<p class="sub">还没有。真人验证时按"这句话本身不对"会记到这里。</p>'}</div>`;
  ['gKey', 'trEngine', 'clKey', 'model', 'voice', 'voiceF', 'voiceM', 'theme', 'speech', 'azKey', 'azRegion'].forEach(id => { const el = $('#' + id); if (!el) return;
    el.addEventListener('change', e => { S.set[id] = e.target.value.trim(); if (id === 'voiceF' || id === 'voiceM') S.set.voiceNote = ''; save(); applyTheme(); if (id === 'speech') viewSet(); }); });
  const out = (el, ok, t) => { const r = $(el); r.className = 'res ' + (ok ? 'ok' : 'bad'); r.textContent = t; };
  const fail = e => out('#tRes', false, (e.zh || '出错') + (e.detail ? '\u3000' + e.detail : (e.zh ? '' : '\u3000' + String(e))));
  const holdTest = (id, lang, what) => bindHold($(id), { error: fail, info: t => out('#tRes', true, t), done: async wav => { out('#tRes', true, '正在听写…'); try { const r = await stt(wav, lang); out('#tRes', r.ok, r.ok ? what + '听写接口正常，听到的是：' + r.text : '接口通了，但没听出内容（接口返回：' + r.status + '）'); } catch (e) { fail(e); } } });
  holdTest('#tSttBtn', 'zh-CN', '中文'); holdTest('#tKmBtn', 'km-KH', '高棉语');
  let cmp = [];
  $('#cmp').addEventListener('submit', async e => {
    e.preventDefault(); const zh = $('#cmpIn').value.trim(); if (!zh) return;
    const engines = [['gemini', S.set.gKey], ['claude', S.set.clKey]].filter(x => x[1]).map(x => x[0]);
    const box = $('#cmpRes');
    if (!engines.length) { box.innerHTML = errHTML(new AppErr('两家的密钥都还没填', '')); return; }
    box.innerHTML = '<p class="sub">正在翻译…</p>'; cmp = [];
    const res = await Promise.all(engines.map(en => translate(zh, null, en).then(p => ({ en, p }), err => ({ en, err }))));
    cmp = res;
    box.innerHTML = res.map((x, i) => x.err ? `<div class="tips"><p><b>${engineName(x.en)}</b></p>${errHTML(x.err)}</div>`
      : `<div class="tips"><p><b>${engineName(x.en)}</b></p><p class="km" lang="km" style="font-size:24px">${esc(x.p.km)}</p><p class="sub">${esc(x.p.ro)}</p><p class="sub">直译回中文：${esc(x.p.back)}</p>${x.p.note ? `<p class="sub">提醒：${esc(x.p.note)}</p>` : ''}
         <div class="btns"><button class="b pri" data-act="cmpPlay" data-i="${i}">播放</button><button class="b" data-act="cmpSlow" data-i="${i}">慢速</button></div></div>`).join('');
  });
  ACTS = {
    selfTest: async b => {
      b.disabled = true; const box = $('#stRes'), lines = [];
      const add = (ok, title, detail) => { lines.push(`<p class="res ${ok ? 'ok' : 'bad'}">${ok ? '通过' : '没通过'}：${esc(title)}${detail ? `<br><span class="sub">${esc(detail)}</span>` : ''}</p>`); box.innerHTML = lines.join(''); };
      const step = async (title, fn) => {
        box.innerHTML = lines.join('') + `<p class="sub">正在测：${esc(title)}…</p>`; const t0 = Date.now();
        try { const d = await fn(); add(true, title + '（用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）', d); }
        catch (e) { console.error(e); add(false, title, (e.zh || '程序出错') + '\u3000' + (e.detail || (e.zh ? '' : String(e && (e.stack || e))))); }
      };
      const KM = 'ថ្ងៃនេះទៅដាក់ទឹកនៅម៉ាស៊ីន', ZH = '今天去给机器补饮料';
      let kmBuf = null, zhBuf = null;
      await step('念高棉语，女声 ' + voiceName('f'), async () => { kmBuf = await ttsFetch(KM, 'f', false); return '收到 ' + kmBuf.byteLength + ' 字节的声音' + (S.set.voiceNote ? '。' + S.set.voiceNote : ''); });
      await step('念高棉语，男声 ' + voiceName('m'), async () => { const x = await ttsFetch(KM, 'm', false); return '收到 ' + x.byteLength + ' 字节的声音' + (S.set.voiceNote ? '。' + S.set.voiceNote : ''); });
      if (!useAz()) {
        if (kmBuf) await step('听高棉语（把刚才念的那句听回来）', async () => { const r = await stt(new Blob([kmBuf], { type: 'audio/wav' }), 'km-KH'); if (!r.ok) throw new AppErr('没听出内容', r.status + '\u3000走的是' + r.via); return '原句：' + KM + '\u3000听到：' + r.text + (normKm(r.text) === normKm(KM) ? '\u3000一字不差' : '\u3000和原句不完全一样') + '\u3000走的是' + r.via; });
        await step('听中文（先念一句中文，再听回来）', async () => { const z = zhBuf = await ttsFetch(ZH, 'f', false); const r = await stt(new Blob([z], { type: 'audio/wav' }), 'zh-CN'); if (!r.ok) throw new AppErr('没听出内容', r.status + '\u3000走的是' + r.via); return '原句：' + ZH + '\u3000听到：' + r.text + '\u3000走的是' + r.via; });
      }
      if (!useAz() && fastOn()) {   // 对话页实际走的路：谷歌边听边翻，先出一句、再补逐词
        if (kmBuf) await step('对话用：直接听高棉语并翻成中文', async () => { const d = await hearKm(new Blob([kmBuf], { type: 'audio/wav' })); if (!d.km && !d.zh) throw new AppErr('没听出内容', ''); return '原句：' + KM + '\u3000听到：' + d.km + (normKm(d.km) === normKm(KM) ? '\u3000一字不差' : '\u3000和原句不完全一样') + '\u3000中文：' + d.zh + (d.sure ? '' : '\u3000（它说拿不准：' + d.note + '）'); });
        if (zhBuf) await step('对话用：直接听中文并翻成高棉语', async () => { const d = await hearZh(new Blob([zhBuf], { type: 'audio/wav' })); if (!d.zh) throw new AppErr('没听出内容', ''); return '听到：' + d.zh + ' → ' + d.km; });
        let qk = '';
        await step('对话用：打字翻译，先出一句高棉语', async () => { qk = await quickKm(ZH); return ZH + ' → ' + qk; });
        if (qk) await step('对话用：随后补上逐词和读音', async () => { const p = await fillDetail(basePhrase(ZH, qk)); return '读音：' + p.ro + '\u3000直译回中文：' + p.back + (p.words.length ? '' : '\u3000（逐词拆分和整句对不上，这句没用上逐词）'); });
      }
      for (const en of [['gemini', S.set.gKey], ['claude', S.set.clKey]].filter(x => x[1]).map(x => x[0]))
        await step(engineName(en) + '：中文翻高棉语', async () => { const p = await translate(ZH, null, en); return ZH + ' → ' + p.km + '\u3000直译回中文：' + p.back + (p.words.length ? '' : '\u3000（逐词拆分和整句对不上，这句没用上逐词）'); });
      await step(engineName() + '：高棉语翻中文', async () => { const j = await kmToZh(KM); return KM + ' → ' + j.zh + (j.sure ? '' : '\u3000（它说拿不准：' + j.note + '）'); });
      lines.push('<p class="sub">自检完成。麦克风录音这一步自检测不到，要你按住话筒说话才知道。</p>'); box.innerHTML = lines.join('');
      b.disabled = false; if (kmBuf) playBuf(kmBuf).catch(console.warn);
    },
    cmpPlay: b => say(cmp[+b.dataset.i].p.km), cmpSlow: b => say(cmp[+b.dataset.i].p.km, { slow: true }),
    tTts: async () => { out('#tRes', true, '正在请求…'); try { const b = await ttsFetch('សួស្តី', S.set.voice, false); out('#tRes', !S.set.voiceNote, (S.set.voiceNote ? S.set.voiceNote + '\u3000' : '') + '发音正常，收到 ' + b.byteLength + ' 字节的声音，正在播放。'); await playBuf(b); } catch (e) { fail(e); } },
    tCl: async () => { out('#tRes', true, '正在请求…'); try { const p = await translate('你好'); out('#tRes', true, engineName() + '翻译正常：你好 → ' + p.km + '（' + p.ro + '）'); } catch (e) { fail(e); } },
    dl: async b => {
      b.disabled = true; const all = []; COURSE.forEach(u => u.items.forEach(it => all.push(it.km))); EAR.forEach(e => e.pairs.forEach(p => all.push(p.a[0], p.b[0])));
      const uniq = [...new Set(all)]; let n = 0, bad = 0, lastErr = null;
      for (const t of uniq) { for (const slow of (useAz() ? [false, true] : [false])) { try { await ttsBuf(t, S.set.voice, slow); } catch (e) { bad++; lastErr = e; if (bad >= 3) break; } } if (bad >= 3) break; n++; out('#dlRes', true, `已下载 ${n} / ${uniq.length} 句`); }
      if (lastErr) out('#dlRes', false, `下载中断，成功 ${n} 句。原因：${lastErr.zh || lastErr}\u3000${lastErr.detail || ''}`); else out('#dlRes', true, `全部 ${uniq.length} 句的${S.set.voice === 'f' ? '女声' : '男声'}发音都已存进手机。`);
      b.disabled = false;
    },
    wipe: b => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '再点一次，确定清掉'; return; } const set = S.set, log = S.log, gloss = S.gloss; S = defState(); S.set = set; S.log = log; S.gloss = gloss; save(); viewSet(); },
    gPlay: b => say(S.gloss[+b.dataset.i].km),
    gDel: b => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '再点一次删除'; return; } S.gloss.splice(+b.dataset.i, 1); save(); viewSet(); },
    gAdd: () => wordCapture($('#gBox'), { zh: '', old: '', done: () => viewSet() })
  };
}

/* ---------- 启动 ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('离线缓存没装上', e));
go(missingKeys().length ? 'set' : 'tr');
})();
