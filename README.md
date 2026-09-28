# LectureScribe

LectureScribe is a local-first macOS app for recording or importing lectures, transcribing them on-device, and turning completed transcripts into study notes.

Audio, transcripts, and generated summaries stay on your Mac. An internet connection is used only when you explicitly download a model.

## Features

- Record from your Mac microphone or import an audio file.
- Transcribe locally with Whisper Small and Metal acceleration.
- Create local summaries and main study points with LFM2.5-1.2B-Instruct through llama.cpp and Metal.
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

| Purpose       | Model                                  | Download size |
| ------------- | -------------------------------------- | ------------- |
| Transcription | Whisper Small or Whisper Small English | 466 MB        |
| Study notes   | LFM2.5-1.2B-Instruct Q4_K_M            | 1.17 GB       |

The application uses the official model repositories:

- [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)
- [LiquidAI/LFM2.5-1.2B-Instruct-GGUF](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF)

Downloaded model files, recordings, and note data are stored at:

```text
~/Library/Application Support/LectureScribe/
```

The LFM model is unloaded from memory after each summary. Downloaded model files remain on disk so future summaries can start without another download.

## Use

1. Download a Whisper model from the left sidebar.
2. Record a class or import an audio file.
3. Press **Transcribe**.
4. Download the LFM model from the left sidebar, then press **Summarize** on a completed transcript.
5. Click a note title to rename it, or use **Export Markdown** to save its metadata, summary, study points, and transcript.

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

GitHub builds are unsigned test builds. macOS may require users to Control-click the app, choose **Open**, then confirm **Open** again.

If Gatekeeper still blocks an app that a user intentionally downloaded from this repository:

```sh
xattr -dr com.apple.quarantine /Applications/LectureScribe.app
```

Build and package an unsigned Release app for a GitHub Release:

```sh
xcodebuild \
  -workspace "macos/LectureScribe.xcworkspace" \
  -scheme "LectureScribe-macOS" \
  -configuration Release \
  -sdk macosx \
  CODE_SIGNING_ALLOWED=NO \
  build

ditto -c -k --sequesterRsrc --keepParent \
  "/path/to/LectureScribe.app" \
  "LectureScribe-macOS-unsigned.zip"
```

The DerivedData folder name can differ between Macs. Locate the generated `LectureScribe.app` under Xcode's DerivedData folder before running the packaging command.

## Privacy

LectureScribe does not send recordings, transcripts, or summaries to a transcription or AI service. Model downloads are requested directly by the user and use the app's network permission only for that purpose.
