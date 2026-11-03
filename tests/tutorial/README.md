# Student guide video (narrated)

Records a narrated, subtitled 1280x840 MP4 of one student going end to end: sign up, emailed code, complete profile, verified and assigned
by the examination office (real staff API calls between scenes), sign in, sit the live paper, submit, receipt.
Synthetic data on the disposable local stack only. It is not part of the normal suite (`tests/e2e`). **Never point it at the live site**:
it creates an account, verifies and enrols it, admits it to an exam and submits an attempt.

1. Voice (Kokoro neural TTS, offline once downloaded): `pip install kokoro-onnx soundfile`, download `kokoro-v1.0.onnx` and `voices-v1.0.bin`
   from https://huggingface.co/fastrtc/kokoro-onnx, then `python tests/tutorial/tts.py <model-dir> <voice-dir>`.
   The words are in `narration.json` (`say` = spoken, `sub` = subtitle when different).
2. Recording (actions wait for each line, so they follow the narration):

       source /tmp/stab-env.sh   # disposable PostgreSQL :54397 / Redis :6397
       TUTORIAL_OUT=<out> TUTORIAL_VOICE=<voice-dir> npx playwright test -c playwright.tutorial.config.ts

3. Build: `node tests/tutorial/build-video.mjs <out>` mixes the clips at their cue times and burns step labels and subtitles into the strip.

The browser recorder needs Playwright's ffmpeg build; in this sandbox a wrapper to the system ffmpeg was placed at `/opt/pw-browsers/ffmpeg-1013/ffmpeg-linux`.
