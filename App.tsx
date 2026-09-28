import { useEffect, useState } from 'react';
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

  return (
    <View style={styles.app}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.sidebar}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>LectureScribe</Text>
          <Pressable
            accessibilityRole="button"
            onPress={startRecording}
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
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={importAudio} style={styles.importButton}>
          <Text style={styles.importText}>Import audio</Text>
        </Pressable>
      </View>

      <View style={styles.workspace}>
        <View style={styles.toolbar}>
          <Text style={styles.toolbarTitle}>All Notes</Text>
          <View style={styles.toolbarActions}>
            <Pressable
              accessibilityRole="button"
              onPress={importAudio}
              style={styles.toolbarButton}
            >
              <Text style={styles.toolbarButtonText}>Import Audio</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={startRecording}
              style={styles.toolbarPrimaryButton}
            >
              <Text style={styles.toolbarPrimaryButtonText}>Record</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.recordingArea}>
          <Text style={styles.sectionLabel}>
            {recording ? 'RECORDING NOW' : 'NEW CLASS NOTE'}
          </Text>
          <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={recording ? stopRecording : startRecording}
            style={[
              styles.recordButton,
              recording && styles.recordButtonActive,
            ]}
          >
            <View style={styles.recordCore} />
          </Pressable>
          <Text style={styles.recordHint}>
            {recording
              ? 'Click to finish recording'
              : 'Click to record from your microphone'}
          </Text>
        </View>

        <View style={styles.historyHeader}>
          <Text style={styles.historyTitle}>Previous transcriptions</Text>
          <Text style={styles.noteCount}>
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.noteList}>
          {notes.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                Your notes will collect here.
              </Text>
              <Text style={styles.emptyText}>
                Record a lecture or import a class audio file to begin.
              </Text>
            </View>
          ) : (
            notes.map(note => (
              <View key={note.id} style={styles.noteCard}>
                <View style={styles.noteTopLine}>
                  <View>
                    {editingID === note.id ? (
                      <TextInput
                        autoFocus
                        defaultValue={note.title}
                        onEndEditing={event =>
                          renameNote(note, event.nativeEvent.text)
                        }
                        style={styles.titleInput}
                      />
                    ) : (
                      <Pressable onPress={() => setEditingID(note.id)}>
                        <Text style={styles.noteTitle}>{note.title}</Text>
                      </Pressable>
                    )}
                    <Text style={styles.noteMeta}>
                      {formatDate(note.createdAt)} ·{' '}
                      {formatDuration(note.duration)} ·{' '}
                      {note.source === 'import' ? 'Imported' : 'Recorded'}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.status,
                      note.status === 'complete' && styles.statusComplete,
                    ]}
                  >
                    {note.status === 'transcribing'
                      ? 'Transcribing'
                      : note.status === 'complete'
                      ? 'Complete'
                      : 'Ready'}
                  </Text>
                </View>
                {note.transcript ? (
                  <Text numberOfLines={3} style={styles.transcript}>
                    {note.transcript.trim()}
                  </Text>
                ) : (
                  <Text style={styles.noTranscript}>No transcript yet.</Text>
                )}
                {note.summary ? (
                  <View style={styles.summaryBlock}>
                    <Text style={styles.summaryLabel}>STUDY NOTES</Text>
                    <Text style={styles.summaryText}>{note.summary}</Text>
                    {note.mainPoints?.map(point => (
                      <Text key={point} style={styles.mainPoint}>
                        - {point}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <View style={styles.noteActions}>
                  <Pressable
                    onPress={() => togglePlayback(note.id)}
                    style={styles.secondaryAction}
                  >
                    <Text style={styles.secondaryActionText}>
                      {playingID === note.id ? 'Stop audio' : 'Listen'}
                    </Text>
                  </Pressable>
                  {note.status === 'transcribing' ? (
                    <Pressable
                      disabled={cancellingID === note.id}
                      onPress={() => cancelTranscription(note.id)}
                      style={[
                        styles.secondaryAction,
                        cancellingID === note.id && styles.actionDisabled,
                      ]}
                    >
                      <Text style={styles.secondaryActionText}>
                        {cancellingID === note.id ? 'Cancelling…' : 'Cancel'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {note.status === 'complete' ? (
                    <Pressable
                      disabled={Boolean(summarizingID)}
                      onPress={() => summarize(note)}
                      style={[
                        styles.secondaryAction,
                        summarizingID && styles.actionDisabled,
                      ]}
                    >
                      <Text style={styles.secondaryActionText}>
                        {summarizingID === note.id
                          ? summaryStages[note.id] ?? 'Preparing summary…'
                          : note.summary
                          ? 'Summarize again'
                          : 'Summarize'}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => exportMarkdown(note)}
                    style={styles.secondaryAction}
                  >
                    <Text style={styles.secondaryActionText}>
                      Export Markdown
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={note.status === 'transcribing'}
                    onPress={() => deleteNote(note)}
                    style={[
                      styles.secondaryAction,
                      note.status === 'transcribing' && styles.actionDisabled,
                    ]}
                  >
                    <Text style={styles.deleteActionText}>Delete</Text>
                  </Pressable>
                  <Pressable
                    disabled={Boolean(activeTranscriptionID)}
                    onPress={() => transcribe(note)}
                    style={[
                      styles.primaryAction,
                      activeTranscriptionID && styles.actionDisabled,
                    ]}
                  >
                    <Text style={styles.primaryActionText}>
                      {note.status === 'transcribing'
                        ? transcriptionStages[note.id] ?? 'Preparing audio…'
                        : note.status === 'complete'
                        ? 'Transcribe again'
                        : 'Transcribe'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
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
  modelPanel: { marginTop: 45 },
  panelLabel: {
    marginTop: 22,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#8f9d89',
  },
  modelRow: {
    marginTop: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: '#304033',
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelRowActive: { borderColor: '#bfd585', backgroundColor: '#223023' },
  modelCopy: { flex: 1 },
  modelName: { fontSize: 13, color: '#f6f2e7', fontWeight: '600' },
  modelMeta: { marginTop: 4, fontSize: 11, color: '#9eaa9b' },
  removeModelButton: {
    marginLeft: 10,
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: '#65715f',
    borderRadius: 5,
  },
  removeModelText: { fontSize: 10, color: '#e6b2a9', fontWeight: '700' },
  downloadButton: {
    marginTop: 12,
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#c8df8b',
  },
  downloadText: { fontSize: 12, fontWeight: '700', color: '#172019' },
  importButton: {
    alignItems: 'center',
    padding: 13,
    borderWidth: 1,
    borderColor: '#65715f',
    borderRadius: 8,
  },
  importText: { fontSize: 13, color: '#ecf0e8', fontWeight: '600' },
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
  toolbarTitle: { fontSize: type.title, fontWeight: '600', color: color.label },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
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
    color: '#798070',
  },
  timer: {
    marginTop: 10,
    fontSize: 42,
    letterSpacing: -1,
    color: '#20241f',
    fontVariant: ['tabular-nums'],
  },
  recordButton: {
    width: 76,
    height: 76,
    marginTop: 19,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#c74939',
  },
  recordButtonActive: { backgroundColor: '#a9332c' },
  recordCore: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#fffaf5',
  },
  recordHint: { marginTop: 12, color: '#72776f', fontSize: 12 },
  historyHeader: {
    marginTop: 31,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  historyTitle: { fontFamily: 'Georgia', fontSize: 24, color: '#252822' },
  noteCount: { fontSize: 12, color: '#777c72' },
  noteList: { paddingBottom: 35 },
  noteCard: {
    marginBottom: 12,
    padding: 19,
    borderWidth: 1,
    borderColor: '#dedbd2',
    borderRadius: 11,
    backgroundColor: '#fffcf6',
  },
  noteTopLine: { flexDirection: 'row', justifyContent: 'space-between' },
  noteTitle: { fontSize: 15, color: '#2b2d29', fontWeight: '700' },
  titleInput: {
    minWidth: 220,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#63765d',
    color: '#2b2d29',
    fontSize: 15,
    fontWeight: '700',
  },
  noteMeta: { marginTop: 5, fontSize: 11, color: '#777c72' },
  status: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    color: '#856e33',
    backgroundColor: '#f3e7bd',
    fontSize: 10,
    fontWeight: '700',
  },
  statusComplete: { color: '#456231', backgroundColor: '#dfedcd' },
  transcript: {
    marginTop: 16,
    color: '#41443e',
    fontFamily: 'Georgia',
    fontSize: 15,
    lineHeight: 22,
  },
  noTranscript: {
    marginTop: 16,
    color: '#9a9c94',
    fontStyle: 'italic',
    fontSize: 13,
  },
  summaryBlock: {
    marginTop: 16,
    padding: 13,
    borderLeftWidth: 3,
    borderLeftColor: '#8aa65b',
    backgroundColor: '#f2f5e8',
  },
  summaryLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: '#61754a',
  },
  summaryText: { marginTop: 7, color: '#3e4937', fontSize: 13, lineHeight: 19 },
  mainPoint: { marginTop: 5, color: '#4d5945', fontSize: 12, lineHeight: 17 },
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
    borderColor: '#d8d4ca',
  },
  secondaryActionText: { fontSize: 12, fontWeight: '700', color: '#4f554c' },
  deleteActionText: { fontSize: 12, fontWeight: '700', color: '#9a453c' },
  primaryAction: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#263b28',
  },
  primaryActionText: { fontSize: 12, fontWeight: '700', color: '#f7f6ee' },
  actionDisabled: { opacity: 0.55 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyTitle: { fontFamily: 'Georgia', fontSize: 18, color: '#51564e' },
  emptyText: { marginTop: 8, fontSize: 13, color: '#7b8077' },
});

export default App;
