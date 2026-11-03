// Turns the recorded video.webm + captions.json into an MP4 with a caption strip under the picture.
// usage: node tests/tutorial/build-video.mjs <outDir>   (outDir = the TUTORIAL_OUT used for the recording)
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const dir = path.resolve(process.argv[2] ?? 'test-results-tutorial');
const webm = fs.readdirSync(dir, { recursive: true }).map(String).find((f) => f.endsWith('video.webm')); if (!webm) throw new Error('no video.webm in ' + dir);
const caps = JSON.parse(fs.readFileSync(path.join(dir, 'captions.json'), 'utf8')); const OFFSET = 0.35;       // the video starts a moment before the first caption event
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'; const STRIP = 120;
const wrap = (t, n = 78) => { const out = []; let line = ''; for (const w of t.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); return out.join('\n'); };
const tmp = fs.mkdtempSync(path.join(dir, 'caps-')); const filters = [`pad=iw:ih+${STRIP}:0:0:color=0x14141a`];
caps.forEach((c, i) => {
  if (!c.text) return; const a = Math.max(0, c.t - OFFSET).toFixed(2), b = (caps[i + 1] ? Math.max(0, caps[i + 1].t - OFFSET) : 9999).toFixed(2);
  fs.writeFileSync(path.join(tmp, `s${i}.txt`), c.step.toUpperCase()); fs.writeFileSync(path.join(tmp, `t${i}.txt`), wrap(c.text));
  const en = `enable='between(t,${a},${b})'`;
  filters.push(`drawtext=fontfile=${FONT}:textfile=${tmp}/s${i}.txt:fontcolor=0xb8b8c4:fontsize=15:x=(w-text_w)/2:y=h-${STRIP}+10:${en}`);
  filters.push(`drawtext=fontfile=${BOLD}:textfile=${tmp}/t${i}.txt:fontcolor=white:fontsize=24:line_spacing=6:x=(w-text_w)/2:y=h-${STRIP}+34:${en}`);
});
const out = path.join(dir, 'SZABMU-student-guide.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, webm), '-vf', filters.join(','), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'medium', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true }); console.log('wrote', out);
