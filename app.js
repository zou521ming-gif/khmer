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
async function gGen(system, parts, what, emptyOk, opt) {
  const path = 'models/' + ((opt && opt.model) || S.set.gModel) + ':generateContent';
  const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { thinkingConfig: { thinkingLevel: (opt && opt.level) || 'low' } } };
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
/* 2026-11-13：每按一次都重新打开麦克风要等零点几秒到一秒多，员工一按就开口，开头几个字录不进去，听出来的就是半句。
 * 所以麦克风开一次就留着（两分钟不用或者切到别的窗口再关）。苹果手机例外：麦克风一直开着会让手机放出来的声音变小，所以苹果手机还是每次现开。 */
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const KEEP_MIC = location.protocol === 'file:' || !IS_IOS;
const MIC = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
const wavSecs = wav => ((wav.size - 44) / 32000).toFixed(1);
const Rec = {
  on: false, micName: '', devId: '',
  /* 打开麦克风。苹果电脑旁边有苹果手机时，系统会把手机当成麦克风来用（接通要一两秒，开头几个字录不上，手机还会一直被占着）。
   * 所以电脑上发现用的是手机，而电脑自己有麦克风，就换成电脑自己的。 */
  async pickDev() {   // 该用哪个麦克风：系统默认的不是手机就用默认的（返回空），是手机就挑电脑自己的
    const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.label);
    const phone = d => /iphone|ipad/i.test(d.label), def = all.find(d => d.deviceId === 'default');
    const real = all.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications' && !phone(d));
    if (!real.length || (def ? !phone(def) : !all.some(phone))) return '';
    return (real.find(d => /macbook|built-?in|内建|内置/i.test(d.label)) || real[0]).deviceId;
  },
  async open() {
    const get = id => navigator.mediaDevices.getUserMedia(id ? { audio: Object.assign({ deviceId: { exact: id } }, MIC.audio) } : MIC);
    if (!IS_IOS && !this.devId) { try { this.devId = await this.pickDev(); } catch (e) { console.warn(e); } }   // 权限给过以后，开麦克风之前就能看出默认的是不是手机，直接绕开，不去惊动手机
    let st;
    try { st = await get(this.devId); } catch (e) { if (!this.devId) throw e; this.devId = ''; st = await get(''); }
    const label = () => (st.getAudioTracks()[0] || {}).label || '';
    if (!IS_IOS && /iphone|ipad/i.test(label())) {   // 第一次给权限之前看不到麦克风的名字，开了才知道是手机，这时再换
      try { const id = await this.pickDev(); if (id) { const st2 = await get(id); st.getTracks().forEach(t => t.stop()); st = st2; this.devId = id; } } catch (e) { console.warn('换不成电脑自己的麦克风', e); }
    }
    this.micName = label();
    return st;
  },
  release() { clearTimeout(this.idle); if (this.on) return; try { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); } catch (e) { console.warn(e); } this.stream = null; },
  async warm() {   // 权限以前给过的话，进页面就先把麦克风打开，按下立刻能录
    if (!KEEP_MIC || location.protocol === 'file:' || (this.stream && this.stream.active) || !navigator.mediaDevices || !navigator.permissions) return;
    try { const st = await navigator.permissions.query({ name: 'microphone' }); if (st.state !== 'granted' || this.on || (this.stream && this.stream.active)) return; this.stream = await this.open(); clearTimeout(this.idle); this.idle = setTimeout(() => this.release(), 120000); } catch (e) { console.warn(e); }
  },
  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new AppErr('这个页面现在用不了麦克风', '手机上必须用 https 开头的网址打开才能录音。当前地址：' + location.origin);
    clearTimeout(this.idle);
    try { if (!this.stream || !this.stream.active) this.stream = await this.open(); }
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
    try { this.proc.disconnect(); this.node.disconnect(); if (!KEEP_MIC) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } else if (location.protocol !== 'file:') { clearTimeout(this.idle); this.idle = setTimeout(() => this.release(), 120000); } await this.ctx.close(); } catch (e) { console.warn(e); }
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
    /* 2026-11-13 真密钥实测：没人说话的录音交给模型，它会自己编一句出来（"明天才能去""好的"），改提示词拦不住。所以先在这里量一下有没有人声，没有就不送 */
    const F = 480, rms = [];   // 每 30 毫秒一小段，算这一小段的音量
    for (let i = 0; i + F <= outN; i += F) { let q = 0; for (let j = i; j < i + F; j++) { const v = pcm[j] / 32768; q += v * v; } rms.push(Math.sqrt(q / F)); }
    const floor = Math.min(0.02, rms.slice().sort((a, b) => a - b)[Math.floor(rms.length * 0.1)] || 0);   // 最安静那一成的音量当作环境底噪
    const voiced = rms.filter(v => v > Math.max(0.015, floor * 3)).length * 0.03;
    if (voiced < 0.18) throw new AppErr('没听到说话声。等按钮变红再开口，离麦克风近一点', '录到 ' + secs.toFixed(1) + ' 秒，其中像人声的只有 ' + voiced.toFixed(2) + ' 秒 · 最大音量 ' + peak.toFixed(3) + (this.micName ? ' · 麦克风：' + this.micName : ''));
    const h = new DataView(new ArrayBuffer(44)), W = (p, s) => { for (let i = 0; i < s.length; i++) h.setUint8(p + i, s.charCodeAt(i)); };
    W(0, 'RIFF'); h.setUint32(4, 36 + pcm.byteLength, true); W(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
    h.setUint32(24, 16000, true); h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, pcm.byteLength, true);
    return new Blob([h, pcm], { type: 'audio/wav' });
  }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && location.protocol !== 'file:') Rec.release(); });
/* 按住说话：按下开始录，松开结束。h.done(wav) 处理录音，h.error(e) 显示原因 */
function bindHold(btn, h) {
  let down = false, starting = false, timer = null, tRec = 0, cancel = false;
  const info = t => { if (h.info) h.info(t); };
  const recText = () => '正在录音，说完松开。说错了就把手指往上滑开再松手，这次就不算。' + (Rec.micName ? '（麦克风：' + Rec.micName + '）' : '');
  const setCancel = on => { if (on === cancel) return; cancel = on; btn.style.filter = on ? 'grayscale(1)' : ''; btn.style.opacity = on ? '.6' : ''; info(on ? '现在松手就取消这次录音。不想取消就把手指移回按钮上。' : recText()); };
  function move(e) {   // 按住的时候手指滑开（往上滑过一个按钮的距离，或者离开按钮很远）= 想取消
    if (!down || starting || !tRec) return;
    const r = btn.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    setCancel(dy < -Math.max(60, r.height * 0.8) || Math.hypot(dx, dy) > Math.max(110, r.width * 1.4));
  }
  const setRec = on => { btn.classList.toggle('rec', on); btn.classList.remove('arming'); if (!on) btn.style.removeProperty('--lv'); };
  async function start(e) {
    if (btn.disabled || down || Rec.on) return;
    e.preventDefault(); down = true; starting = true; tRec = 0; cancel = false; clearMsg();
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
    tRec = Date.now(); setRec(true); info(recText()); timer = setTimeout(end, 30000);
  }
  async function end() {
    if (!down) return; down = false; clearTimeout(timer);
    if (starting) return;
    if (cancel) {   // 滑开后松手：这段录音扔掉，什么都不发出去
      btn.style.filter = ''; btn.style.opacity = ''; cancel = false; setRec(false);
      try { await Rec.stop(); } catch (_) {}
      if (h.cancel) h.cancel(); else info('已取消，这次没有发出去。');
      return;
    }
    if (Date.now() - tRec >= 350) await sleep(250);   // 松手后再多录四分之一秒，免得最后一个字被切掉
    setRec(false);
    try { const wav = await Rec.stop(); if (wav) await h.done(wav); } catch (err) { h.error(err); }
  }
  btn.addEventListener('pointerdown', start); btn.addEventListener('pointermove', move); btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end);
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- Claude 翻译 ---------- */
const SYS = `你是土生土长的金边人，同时精通中文。用户是在柬埔寨做饮料自动贩卖机生意的中国男老板，不会高棉语。他会说一句中文，你要把它变成他能直接对本地员工开口说的高棉语。

翻译要求：
1. 用金边人日常口语，像本地老板当面跟员工说话那样自然、客气。不要书面语、公文腔，不要报纸新闻用词，不要王室或僧侣用语。
2. 说话人是男性，听的人是员工，男女都有。绝对不要用 អូន 称呼员工（男人这样叫女员工像在叫女朋友）。称呼怎么用，照下面"称呼"那一条。
3. 下面"固定说法"里列出的词必须照用，不要换别的词。其他像零钱、钥匙这类词，用本地员工平时真正会说的说法，口语里常用的外来词可以用。
4. 一句话一个意思。语法要完整：往哪里、在哪里、给谁、用什么，这些介词和方向词一个都不能省，不要为了简短丢词。往机器、箱子、车这类东西里放、装、补东西时，要说清楚是放进它"里面"，不能只把两个名词并排放。原话如果有歧义，按最可能的工作场景理解，并在 note 里用中文说明你是怎么理解的。
5. 如果原话不是一句要翻译的话（比如空的、乱码），km 留空，note 说明原因。
6. 忠实原话：不要添加原话里没有的意思，也不要漏掉原话里有的意思。
7. 原话是问句，译文也必须是问句，用高棉语里问问题的说法，让人一听就知道是在问，不能变成陈述句。原话有几句，译文也分成几句，不要把两句并成一句。

读音提示 ro 的写法（给只会汉语拼音的人看）：
- 按汉语拼音读：b d g 不送气（对应 ប៉/ព、ត/ទ、ក/គ），p t k 送气（ផ/ភ、ថ/ធ、ខ/ឃ），j = ច/ជ，q = ឆ/ឈ，ny = ញ，ng = ង，w = វ。
- 大写 B、D 表示内爆浊音 ប、ដ。
- e 表示央元音（像拼音"饿"的 e），ae 表示 ែ，双写元音表示长音，词尾 h 表示送气收尾，词尾 j 表示 ច 收尾。
- 词与词之间用空格，词内音节用连字符。
- 只能用普通英文字母 a 到 z、连字符和撇号。绝对不要用 ə、ɔ、ɛ、ɨ、ŋ 这类音标符号，不要加声调符号：央元音一律写 e。
- 这几个称呼的读音固定这样写：ប្អូន = b-oun，បង = Boong，ពូ = buu，មីង = miing。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：
{"km":"整句高棉文。原话有几句就写几句，句和句之间空一格；问句句末保留问号 ?，陈述句句末不加句号","words":[{"km":"一个词","ro":"这个词的读音提示","zh":"这个词的中文意思"}],"ro":"整句读音提示","back":"把高棉语逐词直译回中文，让老板核对意思。称呼对方的词（ប្អូន、បង、ពូ、មីង）在句子里当「你」用时，写成 你（弟妹辈）、你（哥姐辈）、你（叔辈）、你（姨辈），不要只写弟妹、哥姐，words 里这个词的 zh 也这样写","note":"需要提醒老板的事，没有就留空","tip":"这句里中国人最难发准的一两个音，用中文讲嘴型舌位怎么摆，没有就留空"}
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
/* 先拆成分、出一稿、自己逐项对一遍再定稿。2026-11-13 本地人指出"去给机器补货"漏了"进……里面"，实测原来的"尽量简短"会让它丢介词 */
const SELF_CHECK = `{"parts":"用中文把原话拆成成分列出来：时间、谁、做什么、对象、地点或方向、数量，原话没有的不写","draft":"第一稿高棉文","check":"拿上面每个成分逐个对照第一稿，写出漏了、多了或错了什么，尤其看介词和方向词、问句是不是还是问句、句数对不对；没有问题写 无","km":"定稿的高棉文。原话有几句就写几句，句和句之间空一格；问句句末保留问号 ?，陈述句句末不加句号"}`;
const sysFast = () => sysHead() + '分三步做，只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：\n' + SELF_CHECK + '\n如果原话不是一句要翻译的话，km 留空。';
const sysZhAudio = () => sysHead() + '这次他的中文是一段录音。先一字不差听写出他说的中文，再按上面的要求翻成高棉语。分几步做，只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：\n{"zh":"听到的中文原话",' + SELF_CHECK.slice(1) + '\n如果录音里没有人说话或者完全听不清，zh 和 km 都留空。';
const SYS_DETAIL = `你是土生土长的金边人，同时精通中文。下面是一句中文，和已经定下来的高棉语口语译文。不要改译文，只给它配上逐词拆分和读音，方便一个只会汉语拼音的中国人照着念、核对意思。

` + RO_RULES + `只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：
{"words":[{"km":"一个词","ro":"这个词的读音提示","zh":"这个词的中文意思"}],"ro":"整句读音提示","back":"把高棉语逐词直译回中文，让老板核对意思。称呼对方的词（ប្អូន、បង、ពូ、មីង）在句子里当「你」用时，写成 你（弟妹辈）、你（哥姐辈）、你（叔辈）、你（姨辈），不要只写弟妹、哥姐，words 里这个词的 zh 也这样写","note":"只有译文和中文原话意思有出入、或者这句话容易引起误会时才写，一句话说完；没有就留空","tip":"这句里中国人最难发准的一两个音，用中文讲嘴型舌位怎么摆，没有就留空"}
words 里每个词的 km 按顺序直接拼起来必须正好等于整句译文（空格不算）。`;
/* 2026-11-13：老板问"什么时候娶老婆"，员工答的话被逐词翻成"等有钱了再拿"。原因：翻员工的话时只给了这一句，没给前面在聊什么，也没要求写成中国人会说的话 */
const ZH_NATURAL = `先在 lit 里写逐词直译的中文（lit 不看刚才的对话，每个词只按它最常见的字面意思写），再在 zh 里写成中国人平时真会这么说的一句口语，让老板一眼看懂。高棉语口语常常省掉对象，还爱用意思很宽的动词，一个词在中文里要按场合换成不同的说法；zh 里要用中文在这个场合习惯用的那个动词，把省掉的对象补出来。后面如果附了「刚才的对话」，他这句多半是在接上一句，要按上一句在聊什么来确定他指的是什么。刚才的对话只用来弄清他指什么，听写只按这次听到的内容，不能凭对话去猜，也不能加他没说的意思；这句和刚才的对话接不上时，就按字面写，不要硬凑。`;
const SYS_KM_AUDIO = `你是精通高棉语和中文的口译员。录音应该是一位柬埔寨员工对中国老板说的一句高棉语口语，但也可能没人说话，或者说的不是高棉语。老板做饮料自动贩卖机生意。

要求：
1. 先判断录音里有没有人在说话。只有杂音、呼吸声、敲击声，或者什么声音都没有，speech 填 false，其他都留空。绝对不要编造内容，没听到就是没听到。
2. lang 填他说的是什么语言：km 高棉语，zh 中文，en 英语，other 其他。
3. 说的是高棉语：km 里一字不差写成高棉文。说的不是高棉语：km 里用那种语言的文字照原话写下来，zh 仍然写中文意思。
4. ` + ZH_NATURAL + `
5. 不要添加原话没有的内容。数字、金额、时间、地点、人名要准确保留。
6. 听不清、或者拿不准他说的是什么时，sure 填 false，zh 写你认为最可能的意思，note 用中文说明哪里拿不准。拿得准时 sure 填 true，note 留空。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：{"speech":true,"lang":"km","km":"听到的原话","lit":"逐词直译的中文","zh":"中国人会说的中文","sure":true,"note":""}`;
const TR_V = 9;   // 翻译要求的版本号。改了翻译要求就加一，旧版本存下的句子会重新翻（员工听懂过的照旧用）
const trVer = () => { const t = glossText(); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return TR_V + '|' + h; };   // 固定说法表一改，版本也跟着变
const phraseKey = zh => normZh(zh) + (S.set.addr ? '@' + S.set.addr : '');
const fastOn = () => S.set.trEngine !== 'claude' && !!S.set.gKey;
const audioParts = async (wav, more) => [{ inlineData: { mimeType: 'audio/wav', data: await blobToB64(wav) } }, { text: '请听这段录音。' + (more || '') }];
function basePhrase(zh, km) { return { zh, km: String(km).trim(), ro: '', words: [], back: '', note: '', tip: '', by: '谷歌', ts: Date.now(), uses: 0, staff: null, v: trVer() }; }
async function quickKm(zh, prev) {
  let user = '中文原话：' + zh;
  if (prev) user += `\n\n上一次的译法是「${prev}」，本地员工没听懂或者觉得不自然。请换一种更口语、更简单的说法。`;
  const raw = (await gGen(sysFast(), [{ text: user }], '翻译', true)).trim();
  let km = raw; if (raw.includes('{')) { const j = jsonOf(raw, '谷歌'); km = String(j.km || j.draft || ''); }
  km = km.trim().replace(/^["'「“]+|["'」”。។]+$/g, '');
  if (!isKm(km)) throw new AppErr('谷歌没给出高棉文，再试一次', km.slice(0, 300));
  return km;
}
async function hearZh(wav) {   // 听中文录音，一步出中文原话和高棉语
  const j = jsonOf(await gGen(sysZhAudio(), await audioParts(wav), '听和翻译'), '谷歌');
  return { zh: String(j.zh || '').trim(), km: String(j.km || j.draft || '').trim() };
}
/* 带上刚才的对话，中文才翻得像人话；但实测（2026-11-13）带着对话去听一段没人说话的录音，它会顺着对话编一句像样的回答。
   所以同时听两遍：一遍不给对话，听到什么以这遍为准；一遍给对话，两遍听到的高棉文一样才用它的中文。不一样就拿不给对话那遍的高棉文，另外带着对话翻一次。 */
async function hearKm(wav, opt, ctx) {
  if (!ctx) return hearKm1(wav, opt);
  const [a, b] = await Promise.all([hearKm1(wav, opt), hearKm1(wav, opt, ctx).catch(() => null)]);
  if (!a.km || !a.zh || a.lang !== 'km') return a;
  if (b && b.zh && normKm(a.km) === normKm(b.km)) return b;
  const far = !!b && (!b.km || dice2(normKm(a.km), normKm(b.km)) < 0.5);   // 两遍听到的差得很远：多半没录到人声或者没听清，如实标出来
  const warn = far ? '两遍听到的内容差得很远。' : '';
  try { const j = await kmToZh(a.km, ctx); return Object.assign({}, a, { zh: j.zh, lit: j.lit, sure: a.sure && j.sure && !far, note: [warn, a.note, j.note].filter(Boolean).join(' ') }); } catch (e) { return Object.assign({}, a, { sure: a.sure && !far, note: [warn, a.note].filter(Boolean).join(' ') }); }
}
function dice2(x, y) {   // 两段文字有多像：0 完全不同，1 一样（按相邻两个字算）
  const g = t => { const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = g(x), B = g(y); let n = 0, ta = 0, tb = 0;
  A.forEach((v, k) => { ta += v; n += Math.min(v, B.get(k) || 0); }); B.forEach(v => { tb += v; });
  return ta + tb ? 2 * n / (ta + tb) : 0;
}
async function hearKm1(wav, opt, ctx) {   // 听高棉语录音，一步出高棉文和中文意思。ctx：刚才几句对话
  const j = jsonOf(await gGen(SYS_KM_AUDIO, await audioParts(wav, ctxTail(ctx)), '听和翻译', false, opt), '谷歌');
  if (j.speech === false) return { km: '', zh: '', sure: false, note: '' };
  const lang = String(j.lang || 'km'), other = lang !== 'km' ? '他说的不是高棉语' + ({ en: '，是英语', zh: '，是中文' }[lang] || '') + '。' : '';
  return { km: String(j.km || '').trim(), zh: String(j.zh || '').trim(), lit: litOf(j), sure: j.sure !== false, note: other + String(j.note || ''), lang };
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
const WAVS = new WeakMap();   // 员工说的那几句的录音，只留在内存里，给"听录音"用
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
function kmSpans(p, ws) {   // 逐词可点的整句：词之间的空格、问号照原句留着
  let rest = p.km, out = '';
  ws.forEach((w, i) => { const span = `<span class="w" data-act="word" data-i="${i}">${esc(w.km)}</span>`, k = rest.indexOf(w.km);
    if (k < 0) { out += span; return; } out += esc(rest.slice(0, k)) + span; rest = rest.slice(k + w.km.length); });
  return out + esc(rest);
}
function cardHTML(p, extra) {
  const ws = wordsOf(p);
  return `<article class="card ph">
    <p class="zh">${esc(p.zh)}</p>
    <p class="km" lang="km">${ws.length > 1 ? kmSpans(p, ws) : esc(p.km)}</p>
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
let liveStop = null;   // 实时翻译开着的时候，这里是关掉它的函数
document.addEventListener('visibilitychange', () => { if (document.hidden && liveStop) liveStop(); });   // 切到后台就关，免得白白计费
function go(tab) {
  if (liveStop) { liveStop(); liveStop = null; }
  stopAudio(); if (Rec.on) Rec.stop().catch(() => {});
  TAB = tab; document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  ({ tr: viewTr, set: viewSet })[tab]();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
function keyWarn() {
  const miss = missingKeys();
  return miss.length ? `<div class="warn">还没填${miss.join('和')}。<button class="b" data-act="toSet" style="margin-top:8px">去设置里填</button></div>` : '';
}

/* ================= 功能一：对话翻译（双向，按住说话） ================= */
/* 实时翻译（试用）：不用按，两个人直接说。用谷歌的实时同传型号，一条连接只往一种语言翻，所以同时开两条：一条翻成高棉语，一条翻成中文；
   说的话本来就是目标语言时，那条连接不出声。2026-11-13 用机器念的声音实测：目标写 zh 时中文进去不出声，写 zh-Hans 会把中文原样再念一遍，所以用 zh。
   不给它讲清楚是什么生意，它会把"给机器补货"听成"给鸡去捕获"，所以一定要带说明。密钥不放进连接地址，先换一个只能用一次的临时通行证。 */
const LIVE_MODEL = 'models/gemini-3.5-live-translate-preview';
const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=';
const liveSys = () => '说话的人一个是在柬埔寨做饮料自动贩卖机生意的中国老板，一个是他的柬埔寨本地员工，两个人面对面说话。常说的事情：给机器补货、收钱、修机器、送货。翻成对方平时说的口语，意思要准，问句还是问句。\n\n' + trExtra();
const HAS_KM = /[\u1780-\u17FF]/, HAS_ZH = /[\u4E00-\u9FFF]/;   // 这段字里有没有高棉文、有没有汉字
const i16b64 = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(t); };
const MIC_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SYS_KM = `你是精通高棉语和中文的口译员。下面是一位柬埔寨员工对中国老板说的一句高棉语口语，是语音识别出来的文字，可能有同音错字、漏字、断词错误。老板做饮料自动贩卖机生意。

要求：
1. 先结合上下文纠正明显的识别错误。
2. ` + ZH_NATURAL + `
3. 不要添加原话没有的内容。数字、金额、时间、地点、人名要准确保留。
4. 如果这段文字不通顺，你拿不准他说的是什么，sure 填 false，zh 写你认为最可能的意思，note 用中文说明哪里拿不准。拿得准时 sure 填 true，note 留空。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：{"lit":"逐词直译的中文","zh":"中国人会说的中文","sure":true,"note":""}`;
const ctxTail = ctx => ctx ? '\n\n刚才的对话（从早到晚，只用来弄清他这句指的是什么，不要翻译它们）：\n' + ctx : '';
const litOf = (j) => { const l = String(j.lit || '').trim(), z = String(j.zh || '').trim(), n = t => t.replace(/[\s，。！？,.!?、]/g, ''); return l && n(l) !== n(z) ? l : ''; };   // 字面和意思一样就不显示
async function kmToZh(km, ctx) {
  const raw = await llm(SYS_KM, '识别出来的高棉语：' + km + ctxTail(ctx));
  let j; try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch (e) { throw new AppErr(engineName() + '回的内容格式不对，再试一次', raw.slice(0, 300)); }
  if (!j.zh) throw new AppErr(engineName() + '没给出中文意思，再试一次', raw.slice(0, 300));
  return { zh: String(j.zh), lit: litOf(j), sure: j.sure !== false, note: String(j.note || '') };
}
function viewTr() {
  let log = (S.log || []).slice(), active = -1, pend = null, err = null;
  for (let i = log.length - 1; i >= 0; i--) if (log[i].t === 'me') { active = i; break; }
  view.innerHTML = `${keyWarn()}<div id="msg"></div><div class="chat" id="chat"></div>
    <div class="dock"><div class="in">
      <form class="typed" id="typed" hidden><input id="zhIn" placeholder="打中文，比如：去给机器补饮料" autocomplete="off"><button class="b pri">翻译</button></form>
      <div class="tools" style="gap:6px"><select class="pill" id="addrSel" aria-label="对方是谁，决定用什么称呼" style="padding:6px 8px;max-width:128px">${ADDRS.map(a => `<option value="${a[0]}" ${a[0] === (S.set.addr || '') ? 'selected' : ''}>对方：${a[1]}</option>`).join('')}</select><button class="pill" data-act="phr">常用句</button><button class="pill" data-act="kb">打字</button><button class="pill" data-act="clr">清空对话</button></div>
      <button class="pill" id="liveBtn" data-act="live" style="width:100%;margin:8px 0 12px"></button>
      <div class="talk2">
        <div class="talker"><button class="hold kmb" id="hKm" aria-label="员工按住说高棉语">${MIC_SVG}</button><span class="l1 km" lang="km">ខ្មែរ</span><span class="l2">员工按住说高棉语</span></div>
        <div class="talker"><button class="hold zhb" id="hZh" aria-label="我按住说中文">${MIC_SVG}</button><span class="l1">中文</span><span class="l2">我按住说，松开翻译</span></div>
      </div>
    </div></div>`;
  const chat = $('#chat');
  Rec.warm();
  const fit = () => { chat.style.paddingBottom = (view.querySelector('.dock').offsetHeight + 24) + 'px'; };   // 底下那块有多高，对话就让出多高，免得最后一个气泡的按钮被挡住
  const addrSel = $('#addrSel');
  const paintAddr = () => { const on = !!S.set.addr; addrSel.style.background = on ? 'var(--pri)' : ''; addrSel.style.color = on ? '#fff' : ''; };   // 选了称呼就变蓝，提醒现在每句都会带称呼
  addrSel.addEventListener('change', () => { S.set.addr = addrSel.value; save(); paintAddr(); });
  paintAddr();
  const persist = () => { S.log = log.slice(-40); save(); };
  const setErr = (side, e) => { console.error(e); pend = null; err = { side, zh: e instanceof AppErr ? e.zh : '程序出错了', detail: e instanceof AppErr ? e.detail : String(e && (e.stack || e.message) || e) }; render(); };
  function bubble(x, i) {
    if (x.t === 'st') return `<div class="bub st"><p class="who">员工说</p><p class="km" lang="km">${esc(x.km)}</p><p class="bz">${esc(x.zh)}</p>${x.lit ? `<p class="bnote">逐词直译：${esc(x.lit)}</p>` : ''}${x.secs ? `<p class="bnote">录到 ${esc(x.secs)} 秒${+x.secs < 1.2 ? '，很短，可能没录全' : ''}${WAVS.has(x) ? `\u3000<button class="lk" data-act="replay" data-i="${i}" style="color:var(--pri);padding:0">听录音</button>` : ''}</p>` : ''}${x.sure === false ? `<p class="unsure">机器可能没听准，最好请他再说一遍。${esc(x.note)}</p>` : (x.note ? `<p class="bnote">${esc(x.note)}</p>` : '')}</div>`;
    const p = x.p, ws = wordsOf(p);
    if (i !== active) return `<button class="bub me cmp" data-act="sel" data-i="${i}"><span class="bz">${esc(p.zh)}</span><span class="km" lang="km">${esc(p.km)}</span></button>`;
    return `<div class="bub me ph"><p class="who">我说${p.by ? '（' + esc(p.by) + '翻译）' : ''}${p.staff === 'ok' ? '<span class="tag">员工听懂过</span>' : ''}</p><p class="bz">${esc(p.zh)}</p>
      <p class="km" lang="km">${ws.length > 1 ? kmSpans(p, ws) : esc(p.km)}</p>
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
      if (at != null) log[at] = { t: 'me', p, at: Date.now() }; else log.push({ t: 'me', p, at: Date.now() });
      active = at != null ? at : log.length - 1;
      if (fresh) addDetail(p);
      pend = null; persist(); render();
      await say(p.km);
    } catch (e) { setErr('me', e); }
  }
  const ctxOf = () => log.slice(-6).filter(x => x.at && Date.now() - x.at < 600000).map(x => x.t === 'me' ? '老板：' + x.p.zh + '（念给员工听的高棉语：' + x.p.km + '）' : '员工：' + x.km + '（意思：' + x.zh + '）').join('\n');   // 十分钟以内的最近几句，帮它弄清员工这句在接什么话
  async function sendKm(wav) {
    pend = { side: 'st', text: '正在听他说的话…' }; err = null; render();
    try {
      const ctx = ctxOf();
      if (fastOn() && !useAz()) {   // 谷歌一步到位：边听边翻
        const d = await hearKm(wav, null, ctx);
        if (!d.km && !d.zh) throw new AppErr('没听出高棉语，请他离手机近一点再说一次', '录到 ' + wavSecs(wav) + ' 秒，模型说里面没有人在说话');
        const x = { t: 'st', km: d.km, zh: d.zh || '（没翻出来）', lit: d.zh ? d.lit : '', sure: d.sure && !!d.zh, note: d.note, secs: wavSecs(wav), at: Date.now() }; WAVS.set(x, wav);
        log.push(x); pend = null; persist(); render();
        return;
      }
      const r = await stt(wav, 'km-KH');
      if (!r.ok) throw new AppErr('没听出高棉语，请他离手机近一点再说一次', '接口返回：' + r.status);
      pend = { side: 'st', text: '正在翻成中文…', km: r.text }; render();
      const j = await kmToZh(r.text, ctx);
      log.push({ t: 'st', km: r.text, zh: j.zh, lit: j.lit, sure: j.sure, note: j.note, at: Date.now() }); pend = null; persist(); render();
    } catch (e) { setErr('st', e); }
  }
  /* ---- 实时翻译（试用） ---- */
  const live = { on: false, starting: false, ws: [], pcm: new Int16Array(0), timer: 0, ctx: null, node: null, proc: null, playEnd: 0, played: 0, lastVoice: 0, t0: 0, cur: {} };
  window.__km.live = live;
  window.__km.liveFeed = a => { const o = new Int16Array(live.pcm.length + a.length); o.set(live.pcm); o.set(a, live.pcm.length); live.pcm = o; };   // 调试用：不经过麦克风，直接塞一段声音进去
  const paintLive = () => { const b = $('#liveBtn'); if (!b) return; const on = live.on || live.starting;
    b.textContent = live.on ? '实时翻译开着 · 点这里停止' : live.starting ? '正在接通… 点这里取消' : '实时翻译（试用）：点一下开始，两个人直接说，不用按';
    b.style.background = on ? '#e5484d' : ''; b.style.color = on ? '#fff' : '';
    ['#hZh', '#hKm'].forEach(q => { const h = $(q); if (h) { h.disabled = on; h.style.opacity = on ? '.35' : ''; } }); fit(); };
  const liveWant = t => t === 'km' ? 'zh' : 'km';   // 翻成高棉语的那条该听中文，翻成中文的那条该听高棉语
  const liveValid = (t, c) => (c.v || c.own) === liveWant(t);
  function liveShow() {   // 正在说的这一句，边出边显示
    if (!live.on) return;
    const a = live.cur.km, b = live.cur.zh;
    if (a && a.outT && liveValid('km', a)) pend = { side: 'me', km: a.outT, text: a.inT };
    else if (b && b.outT && liveValid('zh', b)) pend = { side: 'st', km: b.inT, text: b.outT };
    else pend = { side: 'me', text: '实时翻译开着：直接说话，不用按。机器念译文的时候先别说话。' + (((b && b.inT) || (a && a.inT)) ? '\u3000听到：' + ((b && b.inT) || a.inT) : '') };
    err = null; render();
  }
  function liveFlush(t) {   // 一句说完（1.8 秒没有新内容）：该算数的变成正式的气泡
    const c = live.cur[t]; if (!c) return; clearTimeout(c.tm); delete live.cur[t];
    const out = c.outT.trim(), ok = liveValid(t, c);
    if (ok) c.hold.forEach(livePlay);
    if (t === 'zh') live.lang = '';
    if (out && ok) {
      if (t === 'km') { const p = basePhrase(c.inT.trim() || '（没记下中文）', out); p.by = '谷歌实时'; log.push({ t: 'me', p, at: Date.now() }); active = log.length - 1; }
      else log.push({ t: 'st', km: c.inT.trim(), zh: out, sure: true, note: '', at: Date.now() });
      persist();
    }
    liveShow();
  }
  function livePlay(b64) {   // 译文的声音是一小段一小段来的，排着队播；全是静音的小段不播
    let buf = b64ToBuf(b64); if (buf.byteLength % 2) buf = buf.slice(0, buf.byteLength - 1);
    const a = new Int16Array(buf); if (!live.ctx || !a.length) return;
    let m = 0; for (let i = 0; i < a.length; i += 8) m += Math.abs(a[i]);
    if (m / Math.ceil(a.length / 8) < 120) return;
    const ab = live.ctx.createBuffer(1, a.length, 24000), f = ab.getChannelData(0); for (let i = 0; i < a.length; i++) f[i] = a[i] / 32768;
    const src = live.ctx.createBufferSource(); src.buffer = ab; src.connect(live.ctx.destination);
    const at = Math.max(live.ctx.currentTime + 0.03, live.playEnd); src.start(at); live.playEnd = at + ab.duration; live.played += ab.duration;
  }
  /* 两条连接听到的是同一段声音，但只有一条该出声。实测（2026-11-13，机器念的声音）：
     翻成中文的那条，听写一直是照实写的（中文写中文，高棉语写高棉文），但听到中文时会把中文原样再念一遍；
     翻成高棉语的那条，听到高棉语时会把"听到的话"写成中文，再把高棉语念回来。
     所以让翻成中文的那条当裁判：它听写出来的是汉字，这句就是中文，只用翻成高棉语那条的结果；是高棉文，就只用翻成中文那条的结果。
     裁判还没出结果时，两条的声音都先留着不播；裁判一直没结果，才退回去看各自听写出来的字。 */
  function liveMsg(t, j) {
    const sc = j.serverContent; if (!sc || !live.on) return;
    const it = sc.inputTranscription, ot = sc.outputTranscription, parts = (sc.modelTurn || {}).parts || [];
    const itx = (it && it.text) || '', otx = (ot && ot.text) || '';
    if (!itx && !otx && !parts.length) return;
    const lang = HAS_KM.test(itx) ? 'km' : HAS_ZH.test(itx) ? 'zh' : '';
    if (t === 'zh' && lang && lang !== live.lang) {   // 裁判说换了一种话：前一句先结掉，再开始新的一句
      if (live.lang) Object.keys(live.cur).forEach(liveFlush);
      live.lang = lang;
      Object.keys(live.cur).forEach(k => { const x = live.cur[k]; x.v = lang; if (lang === liveWant(k)) x.hold.forEach(livePlay); x.hold = []; });
    }
    const c = live.cur[t] || (live.cur[t] = { own: '', inT: '', outT: '', v: '', hold: [] });
    if (live.lang) c.v = live.lang;
    if (itx) { c.inT += itx; if (lang) c.own = lang; }
    if (otx) c.outT += otx;
    for (const p of parts) { const d = p.inlineData || p.inline_data; if (!d || !d.data) continue; if (c.v) { if (c.v === liveWant(t)) livePlay(d.data); } else { c.hold.push(d.data); if (c.hold.length > 16) c.hold.shift(); } }
    if (itx || otx) { live.lastVoice = Date.now(); clearTimeout(c.tm); c.tm = setTimeout(() => liveFlush(t), 1800); liveShow(); }
  }
  function liveOpen(t, sys) {   // 接通一条连接，谷歌回"准备好了"才算数
    return new Promise((res, rej) => {
      gPost('auth_tokens', { uses: 1, expireTime: new Date(Date.now() + 30 * 60000).toISOString(), newSessionExpireTime: new Date(Date.now() + 60000).toISOString() }, '实时翻译').then(tok => {
        const ws = new WebSocket(LIVE_WS + tok.name); let ok = false;
        const to = setTimeout(() => { if (!ok) { try { ws.close(); } catch (e) {} rej(new AppErr('实时翻译没接通，再试一次', '等了 12 秒谷歌没有回应')); } }, 12000);
        ws.onopen = () => ws.send(JSON.stringify({ setup: { model: LIVE_MODEL, systemInstruction: { parts: [{ text: sys }] }, inputAudioTranscription: {}, outputAudioTranscription: {}, generationConfig: { responseModalities: ['AUDIO'], translationConfig: { targetLanguageCode: t } } } }));
        ws.onmessage = async ev => { let j; try { j = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; } if (j.setupComplete) { ok = true; clearTimeout(to); if (!live.starting) { ws.onclose = null; try { ws.close(); } catch (e) {} rej(new AppErr('已取消', '')); return; } live.ws.push(ws); res(ws); return; } liveMsg(t, j); };   // 接通时如果已经点了取消，马上关掉，不留着计费
        ws.onclose = ev => { clearTimeout(to); const d = '连接被关掉：' + ev.code + ' ' + String(ev.reason || '').slice(0, 200);
          if (!ok) rej(new AppErr('实时翻译没接通', d)); else if (live.on) liveEnd(new AppErr('实时翻译断开了，要接着用再点一次', d)); };
      }, rej);
    });
  }
  function liveTick() {   // 每 0.1 秒把刚录到的声音送出去
    if (!live.on) return;
    const fake = !!window.__km.liveFake; let n = Math.min(live.pcm.length, fake ? 1600 : 3200);
    if (!n) { if (!fake) return; n = 1600; live.pcm = new Int16Array(n); }
    let chunk = live.pcm.slice(0, n); live.pcm = live.pcm.slice(n);
    if (live.ctx.currentTime < live.playEnd + 0.4) chunk = new Int16Array(n);   // 机器正在念译文：这一段不送，免得它把自己念的又翻回来
    const msg = JSON.stringify({ realtimeInput: { audio: { data: i16b64(chunk), mimeType: 'audio/pcm;rate=16000' } } });
    live.ws.forEach(w => { if (w.readyState === 1) w.send(msg); });
    if (Date.now() - live.lastVoice > 180000) liveEnd(new AppErr('三分钟没人说话，实时翻译先停了', '开着的时候谷歌按时间收费，所以没人说话就自动停。要用再点一次。'));
    else if (Date.now() - live.t0 > 25 * 60000) liveEnd(new AppErr('实时翻译已经开了 25 分钟，先停一下', '要接着用再点一次。'));
  }
  function liveEnd(e) {   // 关掉。e 有值就把原因显示出来
    const was = live.on || live.starting; if (live.starting && !e) live.cancelled = true; live.on = live.starting = false; clearInterval(live.timer);
    live.ws.forEach(w => { try { w.onclose = null; w.close(); } catch (x) {} }); live.ws = [];
    Object.keys(live.cur).forEach(liveFlush); live.cur = {};
    try { if (live.proc) { live.proc.disconnect(); live.node.disconnect(); } if (live.ctx) live.ctx.close(); } catch (x) { console.warn(x); }
    live.proc = live.node = live.ctx = null; live.pcm = new Int16Array(0);
    if (was && !Rec.on) { clearTimeout(Rec.idle); Rec.idle = setTimeout(() => Rec.release(), 120000); }
    paintLive();
    if (e) setErr('me', e); else if (was) { pend = null; render(); }
  }
  async function liveStart() {
    if (live.on || live.starting) return;
    live.starting = true; live.cancelled = false; stopAudio(); paintLive(); pend = { side: 'me', text: '正在接通实时翻译…' }; err = null; render();
    try {
      const fake = !!window.__km.liveFake, AC = window.AudioContext || window.webkitAudioContext;
      live.ctx = new AC(); await live.ctx.resume();   // 要在点按的当下建，苹果手机才让出声
      if (!fake) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new AppErr('这个页面现在用不了麦克风', '手机上必须用 https 开头的网址打开才能录音。当前地址：' + location.origin);
        clearTimeout(Rec.idle);
        try { if (!Rec.stream || !Rec.stream.active) Rec.stream = await Rec.open(); }
        catch (e) { throw new AppErr(e.name === 'NotAllowedError' ? '麦克风权限被拒绝了，到浏览器设置里允许这个网页用麦克风' : '打不开麦克风', e.name + ': ' + e.message); }
      }
      const sys = liveSys(); live.ws = []; await Promise.all(['km', 'zh'].map(t => liveOpen(t, sys)));
      if (!live.starting) return;   // 还没接通就被点了取消
      live.pcm = new Int16Array(0); live.playEnd = 0; live.played = 0; live.cur = {}; live.lang = ''; live.lastVoice = live.t0 = Date.now();
      if (!fake) {
        live.node = live.ctx.createMediaStreamSource(Rec.stream); live.proc = live.ctx.createScriptProcessor(4096, 1, 1);
        const ratio = live.ctx.sampleRate / 16000;
        live.proc.onaudioprocess = ev => { const d = ev.inputBuffer.getChannelData(0), n = Math.floor(d.length / ratio), o = new Int16Array(live.pcm.length + n); o.set(live.pcm);
          for (let i = 0; i < n; i++) { const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)); let v = 0; for (let k = a; k < b; k++) v += d[k]; o[live.pcm.length + i] = Math.max(-32768, Math.min(32767, Math.round(v / (b - a) * 32767))); }
          live.pcm = o.length > 160000 ? o.slice(-160000) : o; };
        live.node.connect(live.proc); live.proc.connect(live.ctx.destination);
      }
      live.on = true; live.starting = false; live.timer = setInterval(liveTick, 100); paintLive(); liveShow();
    } catch (e) { if (live.cancelled) { live.cancelled = false; return; } liveEnd(e instanceof AppErr ? e : new AppErr('实时翻译开不了', String(e && (e.message || e)))); }
  }
  liveStop = () => liveEnd(); paintLive();
  bindHold($('#hZh'), { error: e => setErr('me', e), cancel: () => { pend = null; render(); }, info: t => { pend = { side: 'me', text: t }; err = null; render(); }, done: async wav => {
    const fast = fastOn() && !useAz();
    pend = { side: 'me', text: fast ? '正在听并翻译…' : '正在听写…' }; err = null; render();
    try {
      if (fast) { const d = await hearZh(wav); if (!d.zh) throw new AppErr('没听清你说的中文，离手机近一点再说一次', ''); await sendZh(d.zh, null, null, d.km); }
      else { const r = await stt(wav, 'zh-CN'); if (!r.ok) throw new AppErr('没听清你说的中文，离手机近一点再说一次', '接口返回：' + r.status); await sendZh(r.text); }
    } catch (e) { setErr('me', e); }
  } });
  bindHold($('#hKm'), { error: e => setErr('st', e), cancel: () => { pend = null; render(); }, info: t => { pend = { side: 'st', text: t }; err = null; render(); }, done: sendKm });
  $('#typed').addEventListener('submit', e => { e.preventDefault(); const v = $('#zhIn').value; $('#zhIn').value = ''; sendZh(v); });
  ACTS = {
    toSet: () => go('set'),
    live: () => (live.on || live.starting) ? liveEnd() : liveStart(),
    sel: b => { active = +b.dataset.i; render(); return say(log[active].p.km); },
    show: () => openShow(CUR.km),
    staffOk: async () => { CUR.staff = 'ok'; await idb('phrases', 'readwrite', s => s.put(CUR, CUR.k || normZh(CUR.zh))); persist(); render(); },
    retry: () => sendZh(CUR.zh, CUR.km, active),
    detail: () => { addDetail(CUR); render(); },
    replay: async b => { const w = WAVS.get(log[+b.dataset.i]); if (w) await playBuf(await w.arrayBuffer()); },
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

/* ================= 设置 ================= */
async function viewSet() {
  CUR = null;
  let nAudio = '?', nPhr = '?';
  try { nAudio = await idb('audio', 'readonly', s => s.count()); nPhr = await idb('phrases', 'readonly', s => s.count()); } catch (e) { console.warn(e); }
  const az = useAz();
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
    <div class="card flat"><p class="big">听高棉语对比</p><p class="sub">员工说的话听不准时用。请员工按住下面的按钮说一句高棉语，同一段录音会同时交给四种听法，结果并排列出来，请员工看哪一种写对了。四种一起跑，会多花一点接口费用。</p>
      <div class="btns"><button class="b pri" id="hcBtn" ${HOLD}>请员工按住说一句高棉语</button><button class="b" data-act="hcPlay" id="hcPlay" hidden>听录音</button></div>
      <div class="res" id="hcSt"></div><div id="hcRes"></div></div>
    <div class="card flat"><p class="big">两家翻译对比</p><p class="sub">同一句中文让谷歌和 Claude 各翻一次，放给本地人听，看谁翻得对。哪家的密钥没填就只出另一家。</p>
      <form class="typed" id="cmp" style="margin-top:10px"><input id="cmpIn" placeholder="打一句你平时会说的中文" autocomplete="off"><button class="b pri">对比</button></form><div id="cmpRes"></div></div>
    <div class="card flat"><p class="big">固定说法表</p><p class="sub">表里的词，翻译时一律照这里的说法。只在某个词真让员工听不懂或者误会时才加，个人说话习惯不用加。</p>
      <ul class="list" id="glossList" style="margin-top:10px">${(S.gloss || []).map((g, i) => `<li><span class="main"><span>${esc(g.zh)}</span><span class="km" lang="km">${esc(g.km)}</span></span><button class="x" data-act="gPlay" data-i="${i}">听</button><button class="x" data-act="gDel" data-i="${i}">删除</button></li>`).join('') || '<li class="sub">表是空的。</li>'}</ul>
      <div class="btns"><button class="b" data-act="gAdd">加一条</button></div><div id="gBox"></div></div>
    <div class="card flat"><p class="big">手机里存的东西</p><p>已存声音 ${nAudio} 段，常用句 ${nPhr} 句。</p></div>`;
  ['gKey', 'trEngine', 'clKey', 'model', 'voice', 'voiceF', 'voiceM', 'theme', 'speech', 'azKey', 'azRegion'].forEach(id => { const el = $('#' + id); if (!el) return;
    el.addEventListener('change', e => { S.set[id] = e.target.value.trim(); if (id === 'voiceF' || id === 'voiceM') S.set.voiceNote = ''; save(); applyTheme(); if (id === 'speech') viewSet(); }); });
  const out = (el, ok, t) => { const r = $(el); r.className = 'res ' + (ok ? 'ok' : 'bad'); r.textContent = t; };
  const fail = e => out('#tRes', false, (e.zh || '出错') + (e.detail ? '\u3000' + e.detail : (e.zh ? '' : '\u3000' + String(e))));
  const holdTest = (id, lang, what) => bindHold($(id), { error: fail, info: t => out('#tRes', true, t), done: async wav => { out('#tRes', true, '正在听写…'); try { const r = await stt(wav, lang); out('#tRes', r.ok, r.ok ? what + '听写接口正常，听到的是：' + r.text : '接口通了，但没听出内容（接口返回：' + r.status + '）'); } catch (e) { fail(e); } } });
  holdTest('#tSttBtn', 'zh-CN', '中文'); holdTest('#tKmBtn', 'km-KH', '高棉语');
  let hcWav = null;
  bindHold($('#hcBtn'), { error: e => out('#hcSt', false, (e.zh || '出错') + (e.detail ? '\u3000' + e.detail : '')), info: t => out('#hcSt', true, t), done: async wav => {
    hcWav = wav; $('#hcPlay').hidden = false;
    out('#hcSt', true, '录到 ' + wavSecs(wav) + ' 秒，四种听法正在听…');
    const ways = [
      ['A 现在对话用的（通用型号，快）', () => hearKm(wav)],
      ['B 通用型号，多想一会儿', () => hearKm(wav, { level: 'medium' })],
      ['C 专用听写型号听，再翻译', async () => {
        const j = await gPost('interactions', { model: 'models/gemini-3.5-transcribe', input: [{ type: 'audio', data: await blobToB64(wav), mime_type: 'audio/wav' }], generation_config: { transcription_config: { language_codes: ['km-KH'] } } }, '听写');
        const km = gText(j).trim(); if (!km) return { km: '', zh: '' };
        const z = await kmToZh(km); return { km, zh: z.zh, sure: z.sure, note: z.note }; }],
      ['D 谷歌更强的型号', () => hearKm(wav, { model: 'gemini-pro-latest' })]
    ];
    const rows = ways.map(w => ({ name: w[0] }));
    const draw = () => { $('#hcRes').innerHTML = rows.map(r => `<div class="tips"><p><b>${esc(r.name)}</b>${r.secs ? '（用时 ' + r.secs + ' 秒）' : ''}</p>${r.err ? errHTML(r.err) : r.d ? `<p class="km" lang="km" style="font-size:22px">${esc(r.d.km || '（没听出来）')}</p><p>${esc(r.d.zh || '')}</p>${r.d.note ? `<p class="sub">${r.d.sure === false ? '它说拿不准：' : ''}${esc(r.d.note)}</p>` : ''}` : '<p class="sub">正在听…</p>'}</div>`).join(''); };
    draw();
    await Promise.all(ways.map(async (w, i) => { const t0 = Date.now(); try { rows[i].d = await w[1](); } catch (e) { console.error(e); rows[i].err = e; } rows[i].secs = ((Date.now() - t0) / 1000).toFixed(1); draw(); }));
    out('#hcSt', true, '录到 ' + wavSecs(wav) + ' 秒。请员工看下面哪一种写的高棉文是对的，再把这一屏截图发给 Claude。');
  } });
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
    gPlay: b => say(S.gloss[+b.dataset.i].km),
    gDel: b => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '再点一次删除'; return; } S.gloss.splice(+b.dataset.i, 1); save(); viewSet(); },
    gAdd: () => wordCapture($('#gBox'), { zh: '', old: '', done: () => viewSet() }),
    hcPlay: async () => { if (hcWav) await playBuf(await hcWav.arrayBuffer()); }
  };
}

/* ---------- 启动 ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('离线缓存没装上', e));
go(missingKeys().length ? 'set' : 'tr');
})();
