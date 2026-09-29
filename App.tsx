import {
  type ComponentProps,
  type ComponentType,
  useEffect,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { color, control, space, type } from './src/theme';
import {
  hasNativeLectureScribe,
  lectureScribe,
  lectureScribeEvents,
  Model,
  Note,
  SummaryModel,
} from './src/LectureScribe';

const formatDuration = (seconds: number) => {
  const rounded = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(
    rounded % 60,
  ).padStart(2, '0')}`;
};

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);

type MacKeyEvent = { nativeEvent: { key: string; metaKey: boolean } };
type MacViewProps = ComponentProps<typeof View> & {
  allowsVibrancy?: boolean;
  keyDownEvents?: Array<{ key: string; metaKey?: boolean }>;
  onKeyDown?: (event: MacKeyEvent) => void;
};
const MacView = View as unknown as ComponentType<MacViewProps>;

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [summaryModels, setSummaryModels] = useState<SummaryModel[]>([]);
  const [modelID, setModelID] = useState<Model['id']>('small');
  const [summaryModelID, setSummaryModelID] =
    useState<SummaryModel['id']>('lfm2.5-1.2b-q4-k-m');
  const [recording, setRecording] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [downloading, setDownloading] = useState<Model['id'] | null>(null);
  const [downloadingSummaryModel, setDownloadingSummaryModel] = useState<
    SummaryModel['id'] | null
  >(null);
  const [playingID, setPlayingID] = useState<string | null>(null);
  const [cancellingID, setCancellingID] = useState<string | null>(null);
  const [transcriptionStages, setTranscriptionStages] = useState<
    Record<string, string>
  >({});
  const [summaryStages, setSummaryStages] = useState<Record<string, string>>(
    {},
  );
  const [summarizingID, setSummarizingID] = useState<string | null>(null);
  const [editingID, setEditingID] = useState<string | null>(null);
  const [selectedNoteID, setSelectedNoteID] = useState<string | null>(null);
  const [detailSection, setDetailSection] = useState<
    'summary' | 'points' | 'transcript'
  >('summary');
  const [transcriptSearchVisible, setTranscriptSearchVisible] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');

  const refresh = async () => {
    if (!hasNativeLectureScribe) return;
    const [savedNotes, availableModels, availableSummaryModels] =
      await Promise.all([
        lectureScribe.getNotes(),
        lectureScribe.getModels(),
        lectureScribe.getSummaryModels(),
      ]);
    setNotes(savedNotes);
    setModels(availableModels);
    setSummaryModels(availableSummaryModels);
  };

  useEffect(() => {
    refresh().catch(showError);
  }, []);

  useEffect(() => {
    const subscription = lectureScribeEvents?.addListener(
      'LectureScribeTranscriptionProgress',
      ({ noteID, stage }) =>
        setTranscriptionStages(current => ({ ...current, [noteID]: stage })),
    );
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    const subscription = lectureScribeEvents?.addListener(
      'LectureScribeSummaryProgress',
      ({ noteID, stage }) =>
        setSummaryStages(current => ({ ...current, [noteID]: stage })),
    );
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (!recordingStartedAt) return;
    const interval = setInterval(
      () => setElapsed((Date.now() - recordingStartedAt) / 1000),
      250,
    );
    return () => clearInterval(interval);
  }, [recordingStartedAt]);

  const startRecording = async () => {
    try {
      await lectureScribe.startRecording();
      setRecording(true);
      setRecordingStartedAt(Date.now());
      setElapsed(0);
    } catch (error) {
      showError(error);
    }
  };

  const stopRecording = async () => {
    try {
      const note = await lectureScribe.stopRecording();
      setNotes(current => [note, ...current]);
    } catch (error) {
      showError(error);
    } finally {
      setRecording(false);
      setRecordingStartedAt(null);
      setElapsed(0);
    }
  };

  const importAudio = async () => {
    try {
      const note = await lectureScribe.importAudio();
      if (note) setNotes(current => [note, ...current]);
    } catch (error) {
      showError(error);
    }
  };

  const download = async (id: Model['id']) => {
    setDownloading(id);
    try {
      await lectureScribe.downloadModel(id);
      await refresh();
      setModelID(id);
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setDownloading(null);
    }
  };

  const downloadSummaryModel = async (id: SummaryModel['id']) => {
    setDownloadingSummaryModel(id);
    try {
      await lectureScribe.downloadSummaryModel(id);
      await refresh();
      setSummaryModelID(id);
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setDownloadingSummaryModel(null);
    }
  };

  const deleteModel = (model: Model) => {
    Alert.alert(
      'Remove model?',
      `${model.name} will be removed from this Mac. You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await lectureScribe.deleteModel(model.id);
              await refresh();
            } catch (error) {
              showError(error);
            }
          },
        },
      ],
    );
  };

  const deleteSummaryModel = (model: SummaryModel) => {
    Alert.alert(
      'Remove model?',
      `${model.name} will be removed from this Mac. You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await lectureScribe.deleteSummaryModel(model.id);
              await refresh();
            } catch (error) {
              showError(error);
            }
          },
        },
      ],
    );
  };

  const transcribe = async (note: Note) => {
    const selected = models.find(model => model.id === modelID);
    if (!selected?.installed) {
      const downloaded = await download(modelID);
      if (!downloaded) return;
    }
    setNotes(current =>
      current.map(item =>
        item.id === note.id ? { ...item, status: 'transcribing' } : item,
      ),
    );
    try {
      const updated = await lectureScribe.transcribe(note.id, modelID);
      setNotes(current =>
        current.map(item => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      await refresh();
      showError(error);
    } finally {
      setCancellingID(current => (current === note.id ? null : current));
      setTranscriptionStages(current => {
        const remaining = { ...current };
        delete remaining[note.id];
        return remaining;
      });
    }
  };

  const cancelTranscription = async (noteID: string) => {
    setCancellingID(noteID);
    try {
      const cancelled = await lectureScribe.cancelTranscription(noteID);
      if (!cancelled)
        setCancellingID(current => (current === noteID ? null : current));
    } catch (error) {
      setCancellingID(current => (current === noteID ? null : current));
      showError(error);
    }
  };

  const togglePlayback = async (noteID: string) => {
    try {
      if (playingID === noteID) {
        await lectureScribe.stopPlayback();
        setPlayingID(null);
      } else {
        await lectureScribe.play(noteID);
        setPlayingID(noteID);
      }
    } catch (error) {
      showError(error);
    }
  };

  const renameNote = async (note: Note, title: string) => {
    const trimmedTitle = title.trim();
    setEditingID(null);
    if (!trimmedTitle || trimmedTitle === note.title) return;
    try {
      const updated = await lectureScribe.renameNote(note.id, trimmedTitle);
      setNotes(current =>
        current.map(item => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      showError(error);
    }
  };

  const deleteNote = (note: Note) => {
    Alert.alert(
      'Delete note?',
      `This will permanently remove “${note.title}” and its audio file.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await lectureScribe.deleteNote(note.id);
              setNotes(current => current.filter(item => item.id !== note.id));
              if (playingID === note.id) setPlayingID(null);
            } catch (error) {
              showError(error);
            }
          },
        },
      ],
    );
  };

  const exportMarkdown = async (note: Note) => {
    try {
      await lectureScribe.exportMarkdown(note.id);
    } catch (error) {
      showError(error);
    }
  };

  const summarize = async (note: Note) => {
    const selected = summaryModels.find(model => model.id === summaryModelID);
    if (!selected?.installed) {
      const downloaded = await downloadSummaryModel(summaryModelID);
      if (!downloaded) return;
    }
    setSummarizingID(note.id);
    try {
      const updated = await lectureScribe.summarize(note.id, summaryModelID);
      setNotes(current =>
        current.map(item => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      showError(error);
    } finally {
      setSummarizingID(null);
      setSummaryStages(current => {
        const remaining = { ...current };
        delete remaining[note.id];
        return remaining;
      });
    }
  };

  const currentModel = models.find(model => model.id === modelID);
  const currentSummaryModel = summaryModels.find(
    model => model.id === summaryModelID,
  );
  const selectedNote =
    notes.find(note => note.id === selectedNoteID) ?? notes[0];
  const activeTranscriptionID = notes.find(
    note => note.status === 'transcribing',
  )?.id;
  const transcriptMatches =
    selectedNote?.transcript && transcriptSearch
      ? selectedNote.transcript
          .toLocaleLowerCase()
          .split(transcriptSearch.toLocaleLowerCase()).length - 1
      : 0;
  const handleKeyDown = (event: MacKeyEvent) => {
    const { key, metaKey } = event.nativeEvent;
    if (metaKey && key.toLowerCase() === 'n') {
      recording ? stopRecording() : startRecording();
    } else if (key === ' ') {
      if (selectedNote) togglePlayback(selectedNote.id);
    } else if (metaKey && key.toLowerCase() === 'f') {
      setDetailSection('transcript');
      setTranscriptSearchVisible(true);
    } else if (metaKey && key.toLowerCase() === 'e' && selectedNote) {
      exportMarkdown(selectedNote);
    }
  };

  return (
    <MacView
      focusable
      keyDownEvents={[
        { key: 'n', metaKey: true },
        { key: ' ' },
        { key: 'f', metaKey: true },
        { key: 'e', metaKey: true },
      ]}
      onKeyDown={handleKeyDown}
      style={styles.app}
    >
      <StatusBar barStyle="dark-content" />
      <MacView allowsVibrancy style={styles.sidebar}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>LectureScribe</Text>
          <Pressable
            accessibilityRole="button"
            onPress={recording ? stopRecording : startRecording}
            style={styles.newNoteButton}
          >
            <Text style={styles.newNoteButtonText}>New Recording</Text>
          </Pressable>
        </View>
        <View style={styles.sourceListHeader}>
          <Text style={styles.sourceListLabel}>NOTES</Text>
          <Text style={styles.sourceListCount}>{notes.length}</Text>
        </View>
        <ScrollView
          style={styles.sourceList}
          contentContainerStyle={styles.sourceListContent}
        >
          {notes.map(note => (
            <Pressable
              key={note.id}
              accessibilityRole="button"
              onPress={() => setSelectedNoteID(note.id)}
              style={[
                styles.noteRow,
                selectedNote?.id === note.id && styles.noteRowSelected,
              ]}
            >
              <View style={styles.noteRowTitleLine}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.noteRowTitle,
                    selectedNote?.id === note.id && styles.noteRowTextSelected,
                  ]}
                >
                  {note.title}
                </Text>
                <Text
                  style={[
                    styles.noteRowStatus,
                    selectedNote?.id === note.id && styles.noteRowTextSelected,
                  ]}
                >
                  {note.status === 'complete'
                    ? 'Summarized'
                    : note.status === 'transcribing'
                    ? 'Transcribing'
                    : note.transcript
                    ? 'Transcribed'
                    : 'Recorded'}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.noteRowMeta,
                  selectedNote?.id === note.id && styles.noteRowTextSelected,
                ]}
              >
                {formatDate(note.createdAt)} · {formatDuration(note.duration)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.modelPanel}>
          <Text style={styles.panelLabel}>LOCAL TRANSCRIPTION</Text>
          {models.map(model => (
            <Pressable
              key={model.id}
              onPress={() => setModelID(model.id)}
              style={[
                styles.modelRow,
                model.id === modelID && styles.modelRowActive,
              ]}
            >
              <View style={styles.modelCopy}>
                <Text style={styles.modelName}>{model.name}</Text>
                <Text style={styles.modelMeta}>
                  {model.size} · {model.installed ? 'Ready' : 'Not installed'}
                </Text>
              </View>
              {model.installed ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => deleteModel(model)}
                  style={styles.removeModelButton}
                >
                  <Text style={styles.removeModelText}>Remove</Text>
                </Pressable>
              ) : null}
            </Pressable>
          ))}
          {!currentModel?.installed ? (
            <Pressable
              onPress={() => download(modelID)}
              style={styles.downloadButton}
            >
              <Text style={styles.downloadText}>
                {downloading === modelID ? 'Downloading…' : 'Download model'}
              </Text>
              {downloading === modelID ? (
                <View style={styles.downloadProgress}>
                  <View style={styles.downloadProgressFill} />
                </View>
              ) : null}
            </Pressable>
          ) : null}
          <Text style={styles.panelLabel}>LOCAL SUMMARIZER</Text>
          {summaryModels.map(model => (
            <Pressable
              key={model.id}
              onPress={() => setSummaryModelID(model.id)}
              style={[
                styles.modelRow,
                model.id === summaryModelID && styles.modelRowActive,
              ]}
            >
              <View style={styles.modelCopy}>
                <Text style={styles.modelName}>{model.name}</Text>
                <Text style={styles.modelMeta}>
                  {model.size} · {model.installed ? 'Ready' : 'Not installed'}
                </Text>
              </View>
              {model.installed ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => deleteSummaryModel(model)}
                  style={styles.removeModelButton}
                >
                  <Text style={styles.removeModelText}>Remove</Text>
                </Pressable>
              ) : null}
            </Pressable>
          ))}
          {!currentSummaryModel?.installed ? (
            <Pressable
              onPress={() => downloadSummaryModel(summaryModelID)}
              disabled={Boolean(downloadingSummaryModel)}
              style={[
                styles.downloadButton,
                downloadingSummaryModel && styles.actionDisabled,
              ]}
            >
              <Text style={styles.downloadText}>
                {downloadingSummaryModel === summaryModelID
                  ? 'Downloading…'
                  : 'Download model'}
              </Text>
              {downloadingSummaryModel === summaryModelID ? (
                <View style={styles.downloadProgress}>
                  <View style={styles.downloadProgressFill} />
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={importAudio} style={styles.importButton}>
          <Text style={styles.importText}>Import audio</Text>
        </Pressable>
      </MacView>

      <View style={styles.workspace}>
        <MacView allowsVibrancy style={styles.toolbar}>
          <View style={styles.toolbarHeading}>
            <Text style={styles.toolbarTitle}>
              {recording ? 'Recording' : 'All Notes'}
            </Text>
            {recording ? (
              <>
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <View style={styles.levelMeter}>
                    {[8, 14, 10, 18, 12].map((height, index) => (
                      <View key={index} style={[styles.levelBar, { height }]} />
                    ))}
                  </View>
                </View>
                <Text style={styles.toolbarTimer}>
                  {formatDuration(elapsed)}
                </Text>
              </>
            ) : null}
          </View>
          <View style={styles.toolbarActions}>
            {transcriptSearchVisible ? (
              <View style={styles.searchField}>
                <TextInput
                  autoFocus
                  value={transcriptSearch}
                  onChangeText={setTranscriptSearch}
                  placeholder="Search transcript"
                  placeholderTextColor={color.tertiaryLabel}
                  style={styles.searchInput}
                />
                <Text style={styles.searchCount}>
                  {transcriptMatches || ''}
                </Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={importAudio}
              style={styles.toolbarButton}
            >
              <Text style={styles.toolbarButtonText}>Import Audio</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={recording ? stopRecording : startRecording}
              style={styles.toolbarPrimaryButton}
            >
              <Text style={styles.toolbarPrimaryButtonText}>
                {recording ? formatDuration(elapsed) : 'Record'}
              </Text>
            </Pressable>
          </View>
        </MacView>
        {selectedNote ? (
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleBlock}>
                {editingID === selectedNote.id ? (
                  <TextInput
                    autoFocus
                    defaultValue={selectedNote.title}
                    onEndEditing={event =>
                      renameNote(selectedNote, event.nativeEvent.text)
                    }
                    style={styles.detailTitleInput}
                  />
                ) : (
                  <Pressable onPress={() => setEditingID(selectedNote.id)}>
                    <Text style={styles.detailTitle}>{selectedNote.title}</Text>
                  </Pressable>
                )}
                <Text style={styles.detailMeta}>
                  {formatDate(selectedNote.createdAt)} ·{' '}
                  {formatDuration(selectedNote.duration)} ·{' '}
                  {selectedNote.source === 'import' ? 'Imported' : 'Recorded'}
                </Text>
              </View>
              <View style={styles.detailActions}>
                <Pressable
                  onPress={() => exportMarkdown(selectedNote)}
                  style={styles.toolbarButton}
                >
                  <Text style={styles.toolbarButtonText}>Export</Text>
                </Pressable>
                <Pressable
                  disabled={selectedNote.status === 'transcribing'}
                  onPress={() => deleteNote(selectedNote)}
                  style={styles.toolbarButton}
                >
                  <Text style={styles.deleteActionText}>Delete</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.playbackBar}>
              <Pressable
                onPress={() => togglePlayback(selectedNote.id)}
                style={styles.playbackButton}
              >
                <Text style={styles.playbackButtonText}>
                  {playingID === selectedNote.id ? 'Stop' : 'Play'}
                </Text>
              </Pressable>
              <View style={styles.playbackTrack}>
                <View style={styles.playbackProgress} />
              </View>
              <Text style={styles.playbackDuration}>
                {formatDuration(selectedNote.duration)}
              </Text>
            </View>
            <View style={styles.segmentedControl}>
              {(['summary', 'points', 'transcript'] as const).map(section => (
                <Pressable
                  key={section}
                  onPress={() => setDetailSection(section)}
                  style={[
                    styles.segment,
                    detailSection === section && styles.segmentSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      detailSection === section && styles.segmentTextSelected,
                    ]}
                  >
                    {section === 'summary'
                      ? 'Summary'
                      : section === 'points'
                      ? 'Study Points'
                      : 'Transcript'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.readingColumn}>
              {detailSection === 'summary' ? (
                <Text style={styles.readingText}>
                  {selectedNote.summary ??
                    'Summarize this transcript when you are ready to review it.'}
                </Text>
              ) : null}
              {detailSection === 'points' ? (
                selectedNote.mainPoints?.length ? (
                  selectedNote.mainPoints.map(point => (
                    <Text key={point} style={styles.pointText}>
                      • {point}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.readingText}>
                    {selectedNote.summary
                      ? 'Study points were not generated for this summary. Choose Summarize Again to try again.'
                      : 'Summarize this transcript to generate study points.'}
                  </Text>
                )
              ) : null}
              {detailSection === 'transcript' ? (
                selectedNote.transcript ? (
                  <Text style={styles.transcriptText}>
                    {selectedNote.transcript.trim()}
                  </Text>
                ) : (
                  <Text style={styles.readingText}>
                    Transcribe this recording to read the lecture here.
                  </Text>
                )
              ) : null}
            </View>
            <View style={styles.noteActions}>
              {selectedNote.status === 'transcribing' ? (
                <Pressable
                  disabled={cancellingID === selectedNote.id}
                  onPress={() => cancelTranscription(selectedNote.id)}
                  style={styles.secondaryAction}
                >
                  <Text style={styles.secondaryActionText}>
                    {cancellingID === selectedNote.id
                      ? 'Cancelling…'
                      : 'Cancel Transcription'}
                  </Text>
                </Pressable>
              ) : null}
              {selectedNote.status === 'complete' ? (
                <Pressable
                  disabled={Boolean(summarizingID)}
                  onPress={() => summarize(selectedNote)}
                  style={styles.secondaryAction}
                >
                  <Text style={styles.secondaryActionText}>
                    {summarizingID === selectedNote.id
                      ? summaryStages[selectedNote.id] ?? 'Preparing summary…'
                      : selectedNote.summary
                      ? 'Summarize Again'
                      : 'Summarize'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={Boolean(activeTranscriptionID)}
                onPress={() => transcribe(selectedNote)}
                style={styles.primaryAction}
              >
                <Text style={styles.primaryActionText}>
                  {selectedNote.status === 'transcribing'
                    ? transcriptionStages[selectedNote.id] ?? 'Preparing audio…'
                    : selectedNote.status === 'complete'
                    ? 'Transcribe Again'
                    : 'Transcribe'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Download a transcription model, then record or import audio.
            </Text>
          </View>
        )}
      </View>
    </MacView>
  );
}

function showError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.';
  Alert.alert('LectureScribe', message);
}

const styles = StyleSheet.create({
  app: { flex: 1, flexDirection: 'row', backgroundColor: color.background },
  sidebar: {
    width: 280,
    padding: space[4],
    justifyContent: 'space-between',
    backgroundColor: color.controlBackground,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.separator,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: control.toolbarHeight,
  },
  sidebarTitle: { fontSize: type.title, color: color.label, fontWeight: '600' },
  newNoteButton: {
    paddingHorizontal: space[2],
    justifyContent: 'center',
    minHeight: control.compactHeight,
  },
  newNoteButtonText: {
    fontSize: type.body,
    fontWeight: '500',
    color: color.accent,
  },
  sourceListHeader: {
    marginTop: space[4],
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourceListLabel: {
    fontSize: type.caption,
    letterSpacing: 0.6,
    color: color.secondaryLabel,
    fontWeight: '600',
  },
  sourceListCount: {
    fontSize: type.caption,
    color: color.tertiaryLabel,
    fontVariant: ['tabular-nums'],
  },
  sourceList: { flexGrow: 0, marginTop: space[2], maxHeight: 260 },
  sourceListContent: { paddingBottom: space[2] },
  noteRow: {
    paddingHorizontal: space[2],
    paddingVertical: space[2],
    borderRadius: 5,
  },
  noteRowSelected: { backgroundColor: color.selectedContentBackground },
  noteRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space[1],
  },
  noteRowTitle: {
    flex: 1,
    fontSize: type.body,
    color: color.label,
    fontWeight: '500',
  },
  noteRowMeta: {
    marginTop: 2,
    fontSize: type.caption,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  noteRowStatus: { fontSize: type.caption, color: color.secondaryLabel },
  noteRowTextSelected: { color: color.selectedText },
  modelPanel: { marginTop: space[4] },
  panelLabel: {
    marginTop: space[4],
    fontSize: type.caption,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: color.secondaryLabel,
  },
  modelRow: {
    marginTop: space[1],
    paddingVertical: space[1],
    paddingHorizontal: space[2],
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelRowActive: {
    backgroundColor: color.unobtrusiveSelectedContentBackground,
  },
  modelCopy: { flex: 1 },
  modelName: { fontSize: type.body, color: color.label, fontWeight: '500' },
  modelMeta: {
    marginTop: 2,
    fontSize: type.caption,
    color: color.secondaryLabel,
  },
  removeModelButton: {
    marginLeft: space[2],
    paddingHorizontal: space[1],
    minHeight: control.compactHeight,
    justifyContent: 'center',
  },
  removeModelText: { fontSize: type.caption, color: color.accent },
  downloadButton: {
    marginTop: space[2],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  downloadText: { fontSize: type.body, fontWeight: '500', color: color.accent },
  downloadProgress: {
    marginTop: space[1],
    height: 2,
    backgroundColor: color.separator,
  },
  downloadProgressFill: {
    width: '55%',
    height: 2,
    backgroundColor: color.accent,
  },
  importButton: {
    marginTop: space[3],
    minHeight: control.compactHeight,
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  importText: { fontSize: type.body, color: color.accent },
  workspace: { flex: 1, minWidth: 520, backgroundColor: color.background },
  toolbar: {
    height: control.toolbarHeight,
    paddingHorizontal: space[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.separator,
  },
  toolbarHeading: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  toolbarTitle: { fontSize: type.title, fontWeight: '600', color: color.label },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color.danger,
  },
  levelMeter: {
    height: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  levelBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: color.secondaryLabel,
  },
  toolbarTimer: {
    fontSize: type.body,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  searchField: {
    width: 180,
    minHeight: control.compactHeight,
    paddingHorizontal: space[2],
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.separator,
    borderRadius: 5,
    backgroundColor: color.textBackground,
  },
  searchInput: { flex: 1, padding: 0, color: color.label, fontSize: type.body },
  searchCount: {
    fontSize: type.caption,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  toolbarButton: {
    paddingHorizontal: space[2],
    justifyContent: 'center',
    minHeight: control.compactHeight,
  },
  toolbarButtonText: { fontSize: type.body, color: color.accent },
  toolbarPrimaryButton: {
    paddingHorizontal: space[3],
    justifyContent: 'center',
    minHeight: control.compactHeight,
    borderRadius: 5,
    backgroundColor: color.accent,
  },
  toolbarPrimaryButtonText: {
    fontSize: type.body,
    fontWeight: '600',
    color: color.selectedText,
  },
  detailContent: {
    paddingHorizontal: space[8],
    paddingTop: space[8],
    paddingBottom: space[12],
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space[4],
  },
  detailTitleBlock: { flex: 1 },
  detailTitle: {
    fontSize: type.display,
    lineHeight: 34,
    color: color.label,
    fontWeight: '600',
  },
  detailTitleInput: {
    padding: 0,
    fontSize: type.display,
    lineHeight: 34,
    color: color.label,
    fontWeight: '600',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.accent,
  },
  detailMeta: {
    marginTop: space[1],
    fontSize: type.body,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  detailActions: { flexDirection: 'row', alignItems: 'flex-start' },
  playbackBar: {
    marginTop: space[6],
    paddingVertical: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.separator,
  },
  playbackButton: {
    minHeight: control.compactHeight,
    paddingHorizontal: space[3],
    justifyContent: 'center',
    borderRadius: 5,
    backgroundColor: color.controlBackground,
  },
  playbackButtonText: {
    fontSize: type.body,
    color: color.label,
    fontWeight: '500',
  },
  playbackTrack: {
    height: 3,
    flex: 1,
    borderRadius: 2,
    backgroundColor: color.separator,
  },
  playbackProgress: {
    width: '0%',
    height: 3,
    borderRadius: 2,
    backgroundColor: color.accent,
  },
  playbackDuration: {
    fontSize: type.caption,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  segmentedControl: {
    marginTop: space[5],
    alignSelf: 'flex-start',
    flexDirection: 'row',
    padding: 2,
    borderRadius: 6,
    backgroundColor: color.controlBackground,
  },
  segment: {
    paddingHorizontal: space[3],
    minHeight: control.compactHeight,
    justifyContent: 'center',
    borderRadius: 4,
  },
  segmentSelected: { backgroundColor: color.textBackground },
  segmentText: { fontSize: type.body, color: color.secondaryLabel },
  segmentTextSelected: { color: color.label, fontWeight: '500' },
  readingColumn: { maxWidth: 620, marginTop: space[6] },
  readingText: {
    fontSize: type.title,
    lineHeight: 27,
    color: color.secondaryLabel,
  },
  transcriptText: { fontSize: type.title, lineHeight: 28, color: color.label },
  pointText: {
    marginBottom: space[3],
    fontSize: type.title,
    lineHeight: 26,
    color: color.label,
  },
  recordingArea: {
    alignItems: 'center',
    paddingVertical: 28,
    borderBottomWidth: 1,
    borderBottomColor: color.separator,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: '700',
    color: color.secondaryLabel,
  },
  timer: {
    marginTop: 10,
    fontSize: 42,
    letterSpacing: -1,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  recordButton: {
    width: 76,
    height: 76,
    marginTop: 19,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.danger,
  },
  recordButtonActive: { opacity: 0.8 },
  recordCore: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: color.textBackground,
  },
  recordHint: {
    marginTop: 12,
    color: color.secondaryLabel,
    fontSize: type.body,
  },
  historyHeader: {
    marginTop: 31,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  historyTitle: { fontSize: type.title, color: color.label },
  noteCount: { fontSize: type.body, color: color.secondaryLabel },
  noteList: { paddingBottom: 35 },
  noteCard: {
    marginBottom: 12,
    padding: 19,
    borderWidth: 1,
    borderColor: color.separator,
    borderRadius: 11,
    backgroundColor: color.textBackground,
  },
  noteTopLine: { flexDirection: 'row', justifyContent: 'space-between' },
  noteTitle: { fontSize: type.title, color: color.label, fontWeight: '600' },
  titleInput: {
    minWidth: 220,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: color.accent,
    color: color.label,
    fontSize: 15,
    fontWeight: '700',
  },
  noteMeta: {
    marginTop: 5,
    fontSize: type.caption,
    color: color.secondaryLabel,
  },
  status: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    color: color.secondaryLabel,
    backgroundColor: color.controlBackground,
    fontSize: 10,
    fontWeight: '700',
  },
  statusComplete: {
    color: color.label,
    backgroundColor: color.controlBackground,
  },
  transcript: {
    marginTop: 16,
    color: color.label,
    fontSize: 15,
    lineHeight: 22,
  },
  noTranscript: {
    marginTop: 16,
    color: color.secondaryLabel,
    fontStyle: 'italic',
    fontSize: 13,
  },
  summaryBlock: {
    marginTop: 16,
    padding: 13,
    borderLeftWidth: 3,
    borderLeftColor: color.accent,
    backgroundColor: color.controlBackground,
  },
  summaryLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: color.secondaryLabel,
  },
  summaryText: {
    marginTop: 7,
    color: color.label,
    fontSize: type.body,
    lineHeight: 19,
  },
  mainPoint: {
    marginTop: 5,
    color: color.label,
    fontSize: type.body,
    lineHeight: 17,
  },
  noteActions: {
    marginTop: 17,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  secondaryAction: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.separator,
  },
  secondaryActionText: {
    fontSize: type.body,
    fontWeight: '500',
    color: color.label,
  },
  deleteActionText: {
    fontSize: type.body,
    fontWeight: '500',
    color: color.danger,
  },
  primaryAction: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: color.accent,
  },
  primaryActionText: {
    fontSize: type.body,
    fontWeight: '600',
    color: color.selectedText,
  },
  actionDisabled: { opacity: 0.55 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyTitle: { fontSize: type.title, color: color.label },
  emptyText: { marginTop: 8, fontSize: type.body, color: color.secondaryLabel },
});

export default App;
