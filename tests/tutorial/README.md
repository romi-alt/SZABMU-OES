# Student guide video

`student-guide.spec.ts` drives the real UI on the disposable local stack (synthetic data only) and records a captioned 1280x720 video of: sign up, emailed code, complete profile, sign in, attempt a paper, submit and receipt.
It is not part of the normal suite (`tests/e2e`). Run it with the same environment as the browser tests:

    source /tmp/stab-env.sh   # disposable PostgreSQL :54397 / Redis :6397
    TUTORIAL_OUT=/some/dir npx playwright test -c playwright.tutorial.config.ts

Never point it at the live site: it creates an account and submits an attempt.

Then build the captioned MP4 (needs `ffmpeg` with libx264 and drawtext):

    node tests/tutorial/build-video.mjs "$TUTORIAL_OUT"

The browser recorder needs Playwright's ffmpeg build; in this sandbox a wrapper to the system ffmpeg was placed at `/opt/pw-browsers/ffmpeg-1013/ffmpeg-linux`.
