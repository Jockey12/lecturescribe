import {NativeEventEmitter, NativeModules} from 'react-native';

export type NoteStatus = 'ready' | 'transcribing' | 'complete';

export type Note = {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  audioPath: string;
  status: NoteStatus;
  transcript: string;
  source: 'recording' | 'import';
  summary?: string;
  mainPoints?: string[];
};

export type Model = {
  id: 'base' | 'small' | 'medium' | 'small.en';
  name: string;
  size: string;
  installed: boolean;
};

export type TranscriptionProgress = {
  noteID: string;
  stage: string;
};

export type SummaryModel = {
  id: 'lfm2.5-1.2b-q4-k-m' | 'qwen3.5-2b-q4-k-m';
  name: string;
  size: string;
  installed: boolean;
};

export type SummaryProgress = {
  noteID: string;
  stage: string;
};

type LectureScribeNative = {
  getNotes(): Promise<Note[]>;
  getModels(): Promise<Model[]>;
  downloadModel(modelID: Model['id']): Promise<boolean>;
  deleteModel(modelID: Model['id']): Promise<boolean>;
  getSummaryModels(): Promise<SummaryModel[]>;
  downloadSummaryModel(modelID: SummaryModel['id']): Promise<boolean>;
  deleteSummaryModel(modelID: SummaryModel['id']): Promise<boolean>;
  startRecording(): Promise<{id: string}>;
  stopRecording(): Promise<Note>;
  importAudio(): Promise<Note | null>;
  play(noteID: string): Promise<boolean>;
  stopPlayback(): Promise<boolean>;
  transcribe(noteID: string, modelID: Model['id']): Promise<Note>;
  cancelTranscription(noteID: string): Promise<boolean>;
  renameNote(noteID: string, title: string): Promise<Note>;
  deleteNote(noteID: string): Promise<boolean>;
  exportMarkdown(noteID: string): Promise<string | null>;
  summarize(noteID: string, modelID: SummaryModel['id']): Promise<Note>;
  addListener(eventType: string): void;
  removeListeners(count: number): void;
};

export const lectureScribe = NativeModules.LectureScribe as LectureScribeNative;
export const hasNativeLectureScribe = Boolean(lectureScribe);
export const lectureScribeEvents = hasNativeLectureScribe
  ? new NativeEventEmitter(lectureScribe)
  : null;
