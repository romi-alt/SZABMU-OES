// Builds the final MP4 from the recording: video.webm + timeline.json (narration cues) + the voice clips.
// The voice clips are placed at the moment each cue started; subtitles (sentence by sentence) and the step label go in a strip under the picture.
// usage: node tests/tutorial/build-video.mjs <outDir>   (the TUTORIAL_OUT used for the recording; needs ffmpeg with libx264, drawtext, aac)
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';

const dir = path.resolve(process.argv[2] ?? 'test-results-tutorial');
const webm = fs.readdirSync(dir, { recursive: true }).map(String).find((f) => f.endsWith('video.webm')); if (!webm) throw new Error('no video.webm in ' + dir);
const { cues } = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
const OFFSET = 0.3;                                    // the video starts a moment before the timeline clock
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'; const STRIP = 120;
const at = (t) => Math.max(0, t - OFFSET);
const wrap = (t, n = 74) => { const out = []; let line = ''; for (const w of t.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); return out.join('\n'); };
const sentences = (t) => t.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g).map((s) => s.trim()).filter(Boolean);

const tmp = fs.mkdtempSync(path.join(dir, 'build-')); const vf = [`pad=iw:ih+${STRIP}:0:0:color=0x15151b`]; let n = 0;
const draw = (text, a, b, font, size, color, y) => { const f = path.join(tmp, `d${n++}.txt`); fs.writeFileSync(f, text); vf.push(`drawtext=fontfile=${font}:textfile=${f}:fontcolor=${color}:fontsize=${size}:line_spacing=7:x=(w-text_w)/2:y=h-${STRIP}+${y}:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`); };
cues.forEach((c, i) => {
  const start = at(c.t), end = Math.min(at(c.t) + c.dur + 0.35, cues[i + 1] ? at(cues[i + 1].t) : 1e4);
  if (c.step) draw(c.step.toUpperCase(), start, cues[i + 1] && cues[i + 1].step === c.step ? at(cues[i + 1].t) : end, FONT, 15, '0xe0a526', 12);
  const parts = sentences(c.sub); const total = parts.reduce((s, p) => s + p.length, 0); let t = start;
  // group short sentences in pairs so each subtitle has enough to read; split time by length
  const groups = []; for (const p of parts) { const last = groups[groups.length - 1]; if (last && (last + ' ' + p).length <= 140 && last.length < 60) groups[groups.length - 1] = last + ' ' + p; else groups.push(p); }
  groups.forEach((g, j) => { const d = (c.dur * g.length) / total; draw(wrap(g), t, j === groups.length - 1 ? end : t + d, BOLD, 23, 'white', 38); t += d; });
});

const inputs = ['-i', path.join(dir, webm)]; const af = [];
cues.forEach((c, i) => { inputs.push('-i', c.file); const ms = Math.round(at(c.t) * 1000); af.push(`[${i + 1}:a]aresample=48000,adelay=${ms}|${ms},apad[a${i}]`); });
af.push(`${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
fs.writeFileSync(path.join(tmp, 'vf.txt'), vf.join(',')); fs.writeFileSync(path.join(tmp, 'af.txt'), af.join(';'));
const out = path.join(dir, 'SZABMU-student-guide.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex_script', path.join(tmp, 'af.txt'), '-filter_script:v', path.join(tmp, 'vf.txt'),
  '-map', '0:v', '-map', '[aout]', '-shortest', '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0', '-pix_fmt', 'yuv420p', '-crf', '21', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '44100', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true }); console.log('wrote', out);
