# LectureScribe

vibe coded

---

LectureScribe is a local-first macOS app for recording or importing lectures, transcribing them on-device, and turning completed transcripts into study notes.

Audio, transcripts, and generated summaries stay on your Mac. An internet connection is used only when you explicitly download a model.

## Features

- Record from your Mac microphone or import an audio file.
- Transcribe locally with multilingual Whisper Base, Small, or Medium models and Metal acceleration.
- Create local summaries and main study points with LFM2.5-1.2B-Instruct or Qwen3.5-2B through llama.cpp and Metal.
- Rename notes inline, replay audio, export Markdown, and permanently delete notes with their audio.
- Cancel an in-progress transcription.

## Requirements

- macOS 14 or later.
- Node.js 18 or later.
- Xcode and Xcode Command Line Tools.
- CocoaPods.
- Apple Silicon is recommended for best Metal inference performance.

## Run From Source

```sh
npm install
cd macos
pod install
cd ..
npm run macos
```

`npm run macos` starts Metro and launches the Debug macOS app.

## Local Models

Models are downloaded only after selecting the corresponding download control in the app.

| Purpose       | Model                                                        | Download size      |
| ------------- | ------------------------------------------------------------ | ------------------ |
| Transcription | Whisper Base, Small, or Medium (multilingual); Small English | 142 MB to 1.53 GB  |
| Study notes   | LFM2.5-1.2B-Instruct Q4_K_M or Qwen3.5-2B Q4_K_M             | 1.17 GB to 1.28 GB |

The application uses the official model repositories:

- [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)
- [LiquidAI/LFM2.5-1.2B-Instruct-GGUF](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF)
- [unsloth/Qwen3.5-2B-GGUF](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF)

Downloaded model files, recordings, and note data are stored in the standard direct-distribution macOS location:

```text
~/Library/Application Support/LectureScribe/
```

The active model is unloaded from memory after each transcription or summary. Downloaded model files remain on disk so future tasks can start without another download.

## Use

1. Download a Whisper model from the left sidebar. Base, Small, and Medium support multiple languages; Small English is English-only.
2. Record a class or import an audio file.
3. Press **Transcribe**.
4. Download LFM or Qwen from the left sidebar, then press **Summarize** on a completed transcript.
5. Click a note title to rename it, or use **Export Markdown** to save its metadata, summary, study points, and transcript.

Use **Remove** beside an installed model to delete its local file. A model cannot be removed while it is transcribing or summarizing.

Very long transcripts that exceed the local summary context are rejected rather than silently truncated.

## Checks

```sh
npm run lint
npx tsc --noEmit
npm test -- --runInBand
```

To validate the native macOS build:

```sh
xcodebuild \
  -workspace "macos/LectureScribe.xcworkspace" \
  -scheme "LectureScribe-macOS" \
  -configuration Debug \
  -sdk macosx \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## GitHub Test Builds

GitHub builds are self-contained, ad-hoc-signed test builds. They include the native executable, React Native JavaScript bundle, and required frameworks; users do not need Metro, Node.js, Xcode, or the source repository. Models remain on-demand downloads. They are not notarized.

macOS may require users to Control-click the app, choose **Open**, then confirm **Open** again.

If Gatekeeper still blocks an app that a user intentionally downloaded from this repository:

```sh
xattr -dr com.apple.quarantine /Applications/LectureScribe.app
```

Build and package the universal unsigned Release app:

```sh
npm run package:macos
```

The command creates these ignored release artifacts in `dist/`:

- `LectureScribe.app`
- `LectureScribe-macOS-unsigned.zip`
- `LectureScribe-macOS-unsigned.zip.sha256`

Git tags beginning with `v`, such as `v0.1.0`, trigger `.github/workflows/release-macos.yml` to build and attach the ZIP and checksum to a GitHub Release.

## Privacy

LectureScribe does not send recordings, transcripts, or summaries to a transcription or AI service. Model downloads are requested directly by the user and use the app's network permission only for that purpose.
