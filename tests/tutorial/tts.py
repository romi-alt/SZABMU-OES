"""Generates one WAV per narration line with the Kokoro neural voice and writes voice/manifest.json (durations).

usage: python tests/tutorial/tts.py <kokoro-model-dir> <out-dir>
  <kokoro-model-dir> holds kokoro-v1.0.onnx and voices-v1.0.bin (https://huggingface.co/fastrtc/kokoro-onnx)
  needs: pip install kokoro-onnx soundfile
"""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

model_dir, out = sys.argv[1], sys.argv[2]
spec = json.load(open(os.path.join(os.path.dirname(__file__), 'narration.json')))
os.makedirs(os.path.join(out, 'voice'), exist_ok=True)
k = Kokoro(os.path.join(model_dir, 'kokoro-v1.0.onnx'), os.path.join(model_dir, 'voices-v1.0.bin'))
manifest = {}
for key, line in spec['lines'].items():
    samples, sr = k.create(line['say'], voice=spec['voice'], speed=spec['speed'], lang='en-us')
    path = os.path.join(out, 'voice', f'{key}.wav')
    sf.write(path, samples, sr)
    manifest[key] = {'file': path, 'duration': round(len(samples) / sr, 3), 'sub': line.get('sub', line['say'])}
    print(f'{key:12s} {manifest[key]["duration"]:6.2f}s')
json.dump(manifest, open(os.path.join(out, 'voice', 'manifest.json'), 'w'), indent=1)
print('total', round(sum(m['duration'] for m in manifest.values()), 1), 's')
