# Optional reply recordings

The app does **not** require recorded replies. It can use the browser's own
speech synthesis. Recordings are useful when a natural voice or a particular
language voice is unavailable.

Record short clips (1–3 seconds, mono WAV recommended) and place them here:

```
public/audio/en/VILLAGE_STATUS.wav
public/audio/en/LIGHTS_ON.wav
public/audio/ml/LIGHTS_ON.wav
public/audio/hi/HELP.wav
```

Then list them in `manifest.json`:

```json
{
  "version": 1,
  "files": {
    "en": {
      "LIGHTS_ON": "en/LIGHTS_ON.wav",
      "IRRIGATION_STOP": "en/IRRIGATION_STOP.wav"
    },
    "ml": {
      "LIGHTS_ON": "ml/LIGHTS_ON.wav"
    }
  }
}
```

Intent ids are in `shared/intents.json`. The backend's readiness endpoint
reports how many recordings were found. A missing recording simply falls back;
it is never an error and never fetched from the internet.

Do not commit recordings of the child without their family's permission. The
`.gitignore` excludes audio files; only this README and the manifest are
tracked.
