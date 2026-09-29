#import <AVFoundation/AVFoundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <whisper/whisper.h>
#import "LlamaSummarizer.h"

@class LectureScribeModule;

@interface TranscriptionCancellation : NSObject
@property(atomic, getter=isCancelled) BOOL cancelled;
@property(atomic) NSInteger lastProgress;
@property(nonatomic, copy) NSString *noteID;
@property(nonatomic, weak) LectureScribeModule *module;
@end

@implementation TranscriptionCancellation
@end

@interface LectureScribeModule : RCTEventEmitter <RCTBridgeModule>
@property(nonatomic) AVAudioEngine *audioEngine;
@property(nonatomic) AVAudioFile *recordingFile;
@property(nonatomic) NSString *recordingID;
@property(nonatomic) AVAudioPlayer *player;
@property(nonatomic) NSMutableArray<NSMutableDictionary *> *notes;
@property(nonatomic) NSMutableDictionary<NSString *, TranscriptionCancellation *> *activeTranscriptions;
@property(nonatomic, copy) NSString *activeTranscriptionID;
@property(nonatomic, copy) NSString *activeTranscriptionModelID;
@property(nonatomic, copy) NSString *activeSummaryID;
@property(nonatomic, copy) NSString *activeSummaryModelID;
@property(nonatomic) BOOL microphonePermissionRequestInFlight;
- (NSArray<NSString *> *)studyPointsFromGeneratedText:(NSString *)generatedText;
- (NSArray<NSString *> *)fallbackStudyPointsFromSummary:(NSString *)summary;
- (void)emitTranscriptionStage:(NSString *)stage noteID:(NSString *)noteID;
- (void)emitSummaryStage:(NSString *)stage noteID:(NSString *)noteID;
- (void)beginRecordingWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
@end

static bool shouldAbortTranscription(void *userData) {
  return [(__bridge TranscriptionCancellation *)userData isCancelled];
}

static void reportTranscriptionProgress(struct whisper_context *context, struct whisper_state *state, int progress, void *userData) {
  TranscriptionCancellation *cancellation = (__bridge TranscriptionCancellation *)userData;
  if (progress < cancellation.lastProgress + 5 && progress != 100) return;
  cancellation.lastProgress = progress;
  [cancellation.module emitTranscriptionStage:[NSString stringWithFormat:@"Transcribing %d%%", progress] noteID:cancellation.noteID];
}

@implementation LectureScribeModule

RCT_EXPORT_MODULE(LectureScribe)

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[ @"LectureScribeTranscriptionProgress", @"LectureScribeSummaryProgress" ];
}

- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

- (instancetype)init {
  if (self = [super init]) {
    _notes = [NSMutableArray array];
    _activeTranscriptions = [NSMutableDictionary dictionary];
    BOOL recoveredInterruptedTranscription = NO;
    BOOL recoveredStudyPoints = NO;
    for (NSDictionary *savedNote in [self loadNotes]) {
      NSMutableDictionary *note = [savedNote mutableCopy];
      if ([note[@"status"] isEqualToString:@"transcribing"]) {
        note[@"status"] = @"ready";
        recoveredInterruptedTranscription = YES;
      }
      NSString *summary = note[@"summary"];
      NSArray *mainPoints = note[@"mainPoints"];
      if (summary.length > 0 && mainPoints.count == 0) {
        NSArray<NSString *> *recoveredPoints = [self studyPointsFromGeneratedText:summary];
        if (recoveredPoints.count == 0) {
          recoveredPoints = [self fallbackStudyPointsFromSummary:summary];
        }
        if (recoveredPoints.count > 0) {
          note[@"mainPoints"] = recoveredPoints;
          recoveredStudyPoints = YES;
        }
      }
      [_notes addObject:note];
    }
    if (recoveredInterruptedTranscription || recoveredStudyPoints) [self saveNotes];
  }
  return self;
}

- (NSURL *)applicationSupportURL {
  NSURL *url = [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  url = [url URLByAppendingPathComponent:@"LectureScribe" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:url withIntermediateDirectories:YES attributes:nil error:nil];
  return url;
}

- (NSURL *)notesURL {
  return [[self applicationSupportURL] URLByAppendingPathComponent:@"notes.json"];
}

- (NSArray *)loadNotes {
  NSData *data = [NSData dataWithContentsOfURL:[self notesURL]];
  if (!data) return @[];
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [value isKindOfClass:[NSArray class]] ? value : @[];
}

- (void)saveNotes {
  NSData *data = [NSJSONSerialization dataWithJSONObject:self.notes options:0 error:nil];
  [data writeToURL:[self notesURL] atomically:YES];
}

- (NSMutableDictionary *)noteWithID:(NSString *)noteID {
  for (NSMutableDictionary *note in self.notes) {
    if ([note[@"id"] isEqualToString:noteID]) return note;
  }
  return nil;
}

- (void)emitTranscriptionStage:(NSString *)stage noteID:(NSString *)noteID {
  NSLog(@"LectureScribe transcription %@: %@", noteID, stage);
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"LectureScribeTranscriptionProgress" body:@{ @"noteID": noteID, @"stage": stage }];
  });
}

- (void)emitSummaryStage:(NSString *)stage noteID:(NSString *)noteID {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"LectureScribeSummaryProgress" body:@{ @"noteID": noteID, @"stage": stage }];
  });
}

- (NSDictionary *)modelForID:(NSString *)modelID {
  if ([modelID isEqualToString:@"base"]) {
    return @{ @"id": @"base", @"name": @"Whisper Base", @"size": @"142 MB", @"url": @"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" };
  }
  if ([modelID isEqualToString:@"medium"]) {
    return @{ @"id": @"medium", @"name": @"Whisper Medium", @"size": @"1.53 GB", @"url": @"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin" };
  }
  if ([modelID isEqualToString:@"small.en"]) {
    return @{ @"id": @"small.en", @"name": @"Whisper Small English", @"size": @"466 MB", @"url": @"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin" };
  }
  return @{ @"id": @"small", @"name": @"Whisper Small", @"size": @"466 MB", @"url": @"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" };
}

- (BOOL)isSupportedModelID:(NSString *)modelID {
  return [@[ @"base", @"small", @"medium", @"small.en" ] containsObject:modelID];
}

- (NSURL *)modelURL:(NSString *)modelID {
  NSURL *models = [[self applicationSupportURL] URLByAppendingPathComponent:@"Models" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:models withIntermediateDirectories:YES attributes:nil error:nil];
  return [models URLByAppendingPathComponent:[NSString stringWithFormat:@"ggml-%@.bin", modelID]];
}

- (NSDictionary *)summaryModelForID:(NSString *)modelID {
  if ([modelID isEqualToString:@"qwen3.5-2b-q4-k-m"]) {
    return @{ @"id": @"qwen3.5-2b-q4-k-m", @"name": @"Qwen3.5 2B Instruct", @"size": @"1.28 GB", @"url": @"https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf" };
  }
  return @{ @"id": @"lfm2.5-1.2b-q4-k-m", @"name": @"LFM2.5 1.2B Instruct", @"size": @"1.17 GB", @"url": @"https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf" };
}

- (BOOL)isSupportedSummaryModelID:(NSString *)modelID {
  return [@[ @"lfm2.5-1.2b-q4-k-m", @"qwen3.5-2b-q4-k-m" ] containsObject:modelID];
}

- (NSURL *)summaryModelURL:(NSString *)modelID {
  NSURL *models = [[self applicationSupportURL] URLByAppendingPathComponent:@"Models" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:models withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *sourceURL = [self summaryModelForID:modelID][@"url"];
  return [models URLByAppendingPathComponent:sourceURL.lastPathComponent];
}

RCT_REMAP_METHOD(getNotes, getNotesWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(self.notes);
}

RCT_REMAP_METHOD(getModels, getModelsWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableArray *models = [NSMutableArray array];
  for (NSString *modelID in @[ @"base", @"small", @"medium", @"small.en" ]) {
    NSMutableDictionary *model = [[self modelForID:modelID] mutableCopy];
    model[@"installed"] = @([[NSFileManager defaultManager] fileExistsAtPath:[self modelURL:modelID].path]);
    [models addObject:model];
  }
  resolve(models);
}

RCT_REMAP_METHOD(downloadModel, modelID:(NSString *)modelID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![self isSupportedModelID:modelID]) { reject(@"UNKNOWN_MODEL", @"This Whisper model is not available.", nil); return; }
  NSDictionary *model = [self modelForID:modelID];
  NSURL *destination = [self modelURL:modelID];
  if ([[NSFileManager defaultManager] fileExistsAtPath:destination.path]) { resolve(@YES); return; }
  NSURLSessionDownloadTask *task = [[NSURLSession sharedSession] downloadTaskWithURL:[NSURL URLWithString:model[@"url"]] completionHandler:^(NSURL *location, NSURLResponse *response, NSError *error) {
    NSHTTPURLResponse *httpResponse = [response isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)response : nil;
    if (error || !location || httpResponse.statusCode < 200 || httpResponse.statusCode >= 300) {
      NSString *message = error.localizedDescription ?: [NSString stringWithFormat:@"Unable to download model (HTTP %ld).", (long)httpResponse.statusCode];
      reject(@"MODEL_DOWNLOAD_FAILED", message, error);
      return;
    }
    NSError *moveError;
    [[NSFileManager defaultManager] removeItemAtURL:destination error:nil];
    [[NSFileManager defaultManager] moveItemAtURL:location toURL:destination error:&moveError];
    if (moveError) { reject(@"MODEL_SAVE_FAILED", moveError.localizedDescription, moveError); return; }
    resolve(@YES);
  }];
  [task resume];
}

RCT_REMAP_METHOD(deleteModel, deleteModelID:(NSString *)modelID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![self isSupportedModelID:modelID]) { reject(@"UNKNOWN_MODEL", @"This Whisper model is not available.", nil); return; }
  if ([self.activeTranscriptionModelID isEqualToString:modelID]) { reject(@"MODEL_IN_USE", @"Wait for the current transcription to finish or cancel it before deleting this model.", nil); return; }
  NSURL *modelURL = [self modelURL:modelID];
  NSError *error;
  if ([[NSFileManager defaultManager] fileExistsAtPath:modelURL.path] && ![[NSFileManager defaultManager] removeItemAtURL:modelURL error:&error]) { reject(@"MODEL_DELETE_FAILED", error.localizedDescription, error); return; }
  resolve(@YES);
}

RCT_REMAP_METHOD(getSummaryModels, getSummaryModelsWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableArray *models = [NSMutableArray array];
  for (NSString *modelID in @[ @"lfm2.5-1.2b-q4-k-m", @"qwen3.5-2b-q4-k-m" ]) {
    NSMutableDictionary *model = [[self summaryModelForID:modelID] mutableCopy];
    model[@"installed"] = @([[NSFileManager defaultManager] fileExistsAtPath:[self summaryModelURL:modelID].path]);
    [models addObject:model];
  }
  resolve(models);
}

RCT_REMAP_METHOD(downloadSummaryModel, summaryModelID:(NSString *)modelID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![self isSupportedSummaryModelID:modelID]) { reject(@"UNKNOWN_SUMMARY_MODEL", @"This summary model is not available.", nil); return; }
  NSURL *destination = [self summaryModelURL:modelID];
  if ([[NSFileManager defaultManager] fileExistsAtPath:destination.path]) { resolve(@YES); return; }
  NSURL *source = [NSURL URLWithString:[self summaryModelForID:modelID][@"url"]];
  NSURLSessionDownloadTask *task = [[NSURLSession sharedSession] downloadTaskWithURL:source completionHandler:^(NSURL *location, NSURLResponse *response, NSError *error) {
    NSHTTPURLResponse *httpResponse = [response isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)response : nil;
    if (error || !location || httpResponse.statusCode < 200 || httpResponse.statusCode >= 300) {
      NSString *message = error.localizedDescription ?: [NSString stringWithFormat:@"Unable to download summary model (HTTP %ld).", (long)httpResponse.statusCode];
      reject(@"SUMMARY_MODEL_DOWNLOAD_FAILED", message, error);
      return;
    }
    NSError *moveError;
    [[NSFileManager defaultManager] removeItemAtURL:destination error:nil];
    [[NSFileManager defaultManager] moveItemAtURL:location toURL:destination error:&moveError];
    if (moveError) { reject(@"SUMMARY_MODEL_SAVE_FAILED", moveError.localizedDescription, moveError); return; }
    resolve(@YES);
  }];
  [task resume];
}

RCT_REMAP_METHOD(deleteSummaryModel, deleteSummaryModelID:(NSString *)modelID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![self isSupportedSummaryModelID:modelID]) { reject(@"UNKNOWN_SUMMARY_MODEL", @"This summary model is not available.", nil); return; }
  if ([self.activeSummaryModelID isEqualToString:modelID]) { reject(@"SUMMARY_MODEL_IN_USE", @"Wait for the current summary to finish before deleting this model.", nil); return; }
  NSURL *modelURL = [self summaryModelURL:modelID];
  NSError *error;
  if ([[NSFileManager defaultManager] fileExistsAtPath:modelURL.path] && ![[NSFileManager defaultManager] removeItemAtURL:modelURL error:&error]) { reject(@"SUMMARY_MODEL_DELETE_FAILED", error.localizedDescription, error); return; }
  resolve(@YES);
}

- (void)beginRecordingWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject {
  if (self.audioEngine.isRunning) { reject(@"ALREADY_RECORDING", @"A recording is already in progress.", nil); return; }
  self.recordingID = NSUUID.UUID.UUIDString;
  NSURL *recordings = [[self applicationSupportURL] URLByAppendingPathComponent:@"Recordings" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:recordings withIntermediateDirectories:YES attributes:nil error:nil];
  NSURL *url = [recordings URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.caf", self.recordingID]];
  self.audioEngine = [AVAudioEngine new];
  AVAudioInputNode *input = self.audioEngine.inputNode;
  AVAudioFormat *format = [input inputFormatForBus:0];
  NSError *fileError;
  self.recordingFile = [[AVAudioFile alloc] initForWriting:url settings:format.settings error:&fileError];
  if (fileError) { self.audioEngine = nil; reject(@"RECORDING_FAILED", fileError.localizedDescription, fileError); return; }
  [input installTapOnBus:0 bufferSize:4096 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *time) {
    NSError *writeError;
    [self.recordingFile writeFromBuffer:buffer error:&writeError];
  }];
  NSError *engineError;
  [self.audioEngine prepare];
  if (![self.audioEngine startAndReturnError:&engineError]) { [input removeTapOnBus:0]; self.audioEngine = nil; self.recordingFile = nil; reject(@"RECORDING_FAILED", engineError.localizedDescription, engineError); return; }
  resolve(@{ @"id": self.recordingID });
}

RCT_REMAP_METHOD(startRecording, startRecordingWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  if (status == AVAuthorizationStatusAuthorized) { [self beginRecordingWithResolver:resolve rejecter:reject]; return; }
  if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) {
    reject(@"MICROPHONE_DENIED", @"Allow microphone access for LectureScribe in System Settings > Privacy & Security > Microphone.", nil);
    return;
  }
  if (self.microphonePermissionRequestInFlight) { reject(@"MICROPHONE_PERMISSION_PENDING", @"Microphone permission is already being requested.", nil); return; }
  self.microphonePermissionRequestInFlight = YES;
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
    dispatch_async(dispatch_get_main_queue(), ^{
      self.microphonePermissionRequestInFlight = NO;
      if (!granted) { reject(@"MICROPHONE_DENIED", @"Microphone access is required to record a note.", nil); return; }
      [self beginRecordingWithResolver:resolve rejecter:reject];
    });
  }];
}

RCT_REMAP_METHOD(stopRecording, stopRecordingWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!self.audioEngine.isRunning || !self.recordingFile) { reject(@"NOT_RECORDING", @"No recording is in progress.", nil); return; }
  [self.audioEngine.inputNode removeTapOnBus:0];
  [self.audioEngine stop];
  NSURL *url = self.recordingFile.url;
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:nil];
  NSTimeInterval duration = file.length / file.processingFormat.sampleRate;
  NSMutableDictionary *note = [@{ @"id": self.recordingID, @"title": @"Untitled lecture", @"createdAt": @([[NSDate date] timeIntervalSince1970] * 1000), @"duration": @(duration), @"audioPath": url.path, @"status": @"ready", @"transcript": @"", @"source": @"recording" } mutableCopy];
  [self.notes insertObject:note atIndex:0];
  [self saveNotes];
  self.audioEngine = nil;
  self.recordingFile = nil;
  self.recordingID = nil;
  resolve(note);
}

RCT_REMAP_METHOD(importAudio, importAudioWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.allowedContentTypes = @[ UTTypeAudio ];
  panel.allowsMultipleSelection = NO;
  if ([panel runModal] != NSModalResponseOK) { resolve(nil); return; }
  NSURL *source = panel.URL;
  NSString *noteID = NSUUID.UUID.UUIDString;
  NSURL *recordings = [[self applicationSupportURL] URLByAppendingPathComponent:@"Recordings" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:recordings withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *extension = source.pathExtension.lowercaseString;
  if (extension.length == 0) extension = @"audio";
  NSURL *destination = [recordings URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.%@", noteID, extension]];
  NSError *copyError;
  BOOL accessingSource = [source startAccessingSecurityScopedResource];
  [[NSFileManager defaultManager] copyItemAtURL:source toURL:destination error:&copyError];
  if (accessingSource) [source stopAccessingSecurityScopedResource];
  if (copyError) { reject(@"IMPORT_FAILED", copyError.localizedDescription, copyError); return; }
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:destination options:nil];
  NSTimeInterval duration = CMTimeGetSeconds(asset.duration);
  NSString *title = source.URLByDeletingPathExtension.lastPathComponent ?: @"Imported audio";
  NSMutableDictionary *note = [@{ @"id": noteID, @"title": title, @"createdAt": @([[NSDate date] timeIntervalSince1970] * 1000), @"duration": @(isfinite(duration) ? duration : 0), @"audioPath": destination.path, @"status": @"ready", @"transcript": @"", @"source": @"import" } mutableCopy];
  [self.notes insertObject:note atIndex:0];
  [self saveNotes];
  resolve(note);
}

RCT_REMAP_METHOD(play, noteID:(NSString *)noteID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *note = [self noteWithID:noteID];
  if (!note) { reject(@"NOTE_NOT_FOUND", @"This note no longer exists.", nil); return; }
  NSError *error;
  self.player = [[AVAudioPlayer alloc] initWithContentsOfURL:[NSURL fileURLWithPath:note[@"audioPath"]] error:&error];
  if (error || ![self.player play]) { reject(@"PLAYBACK_FAILED", error.localizedDescription ?: @"Unable to play this recording.", error); return; }
  resolve(@YES);
}

RCT_REMAP_METHOD(stopPlayback, stopPlaybackWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self.player stop];
  self.player = nil;
  resolve(@YES);
}

RCT_REMAP_METHOD(renameNote, noteID:(NSString *)noteID title:(NSString *)title resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *note = [self noteWithID:noteID];
  NSString *trimmedTitle = [title stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!note) { reject(@"NOTE_NOT_FOUND", @"This note no longer exists.", nil); return; }
  if (trimmedTitle.length == 0) { reject(@"INVALID_TITLE", @"A note title cannot be empty.", nil); return; }
  note[@"title"] = trimmedTitle;
  [self saveNotes];
  resolve(note);
}

RCT_REMAP_METHOD(deleteNote, deleteNoteID:(NSString *)noteID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *note = [self noteWithID:noteID];
  if (!note) { reject(@"NOTE_NOT_FOUND", @"This note no longer exists.", nil); return; }
  if ([note[@"status"] isEqualToString:@"transcribing"]) { reject(@"NOTE_BUSY", @"Cancel transcription before deleting this note.", nil); return; }
  [self.player stop];
  self.player = nil;
  NSError *fileError;
  NSURL *audioURL = [NSURL fileURLWithPath:note[@"audioPath"]];
  if ([[NSFileManager defaultManager] fileExistsAtPath:audioURL.path] && ![[NSFileManager defaultManager] removeItemAtURL:audioURL error:&fileError]) {
    reject(@"NOTE_DELETE_FAILED", fileError.localizedDescription, fileError);
    return;
  }
  [self.notes removeObject:note];
  [self saveNotes];
  resolve(@YES);
}

- (NSString *)markdownForNote:(NSDictionary *)note {
  NSDateFormatter *formatter = [NSDateFormatter new];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.dateFormat = @"yyyy-MM-dd HH:mm";
  NSDate *createdAt = [NSDate dateWithTimeIntervalSince1970:[note[@"createdAt"] doubleValue] / 1000.0];
  NSMutableString *markdown = [NSMutableString stringWithFormat:@"# %@\n\n- Created: %@\n- Duration: %.0f seconds\n- Source: %@\n", note[@"title"], [formatter stringFromDate:createdAt], [note[@"duration"] doubleValue], note[@"source"]];
  NSString *summary = note[@"summary"];
  if (summary.length > 0) [markdown appendFormat:@"\n## Summary\n\n%@\n", summary];
  NSArray *mainPoints = note[@"mainPoints"];
  if (mainPoints.count > 0) {
    [markdown appendString:@"\n## Main Points\n\n"];
    for (NSString *point in mainPoints) [markdown appendFormat:@"- %@\n", point];
  }
  NSString *transcript = note[@"transcript"];
  if (transcript.length > 0) [markdown appendFormat:@"\n## Transcript\n\n%@\n", transcript];
  return markdown;
}

RCT_REMAP_METHOD(exportMarkdown, exportNoteID:(NSString *)noteID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *note = [self noteWithID:noteID];
  if (!note) { reject(@"NOTE_NOT_FOUND", @"This note no longer exists.", nil); return; }
  NSSavePanel *panel = [NSSavePanel savePanel];
  panel.allowedContentTypes = @[ UTTypeMarkdown ];
  panel.nameFieldStringValue = [NSString stringWithFormat:@"%@.md", note[@"title"]];
  if ([panel runModal] != NSModalResponseOK) { resolve(nil); return; }
  NSError *writeError;
  if (![[self markdownForNote:note] writeToURL:panel.URL atomically:YES encoding:NSUTF8StringEncoding error:&writeError]) {
    reject(@"EXPORT_FAILED", writeError.localizedDescription, writeError);
    return;
  }
  resolve(panel.URL.path);
}

- (NSData *)samplesForURL:(NSURL *)url cancellation:(TranscriptionCancellation *)cancellation error:(NSError **)error {
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:error];
  if (!file) return nil;
  AVAudioFormat *outputFormat = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:16000 channels:1 interleaved:NO];
  AVAudioConverter *converter = [[AVAudioConverter alloc] initFromFormat:file.processingFormat toFormat:outputFormat];
  if (!converter) return nil;
  NSMutableData *samples = [NSMutableData data];
  __block BOOL exhausted = NO;
  __block NSError *readError;
  while (!exhausted) {
    if (cancellation.isCancelled) return nil;
    AVAudioPCMBuffer *output = [[AVAudioPCMBuffer alloc] initWithPCMFormat:outputFormat frameCapacity:8192];
    NSError *conversionError;
    AVAudioConverterOutputStatus status = [converter convertToBuffer:output error:&conversionError withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount packets, AVAudioConverterInputStatus *inputStatus) {
      AVAudioPCMBuffer *input = [[AVAudioPCMBuffer alloc] initWithPCMFormat:file.processingFormat frameCapacity:8192];
      [file readIntoBuffer:input error:&readError];
      // AVAudioFile reports -39 at the end of some CAF recordings. This is an
      // end-of-stream marker, not an audio conversion failure.
      if (readError.code == -39) {
        readError = nil;
        *inputStatus = AVAudioConverterInputStatus_EndOfStream;
        exhausted = YES;
        return nil;
      }
      if (readError) { *inputStatus = AVAudioConverterInputStatus_NoDataNow; return nil; }
      if (input.frameLength == 0) { *inputStatus = AVAudioConverterInputStatus_EndOfStream; exhausted = YES; return nil; }
      *inputStatus = AVAudioConverterInputStatus_HaveData;
      return input;
    }];
    if (cancellation.isCancelled) return nil;
    if (conversionError || readError || status == AVAudioConverterOutputStatus_Error) { if (error) *error = conversionError ?: readError; return nil; }
    if (output.frameLength > 0) [samples appendBytes:output.floatChannelData[0] length:output.frameLength * sizeof(float)];
  }
  return samples;
}

RCT_REMAP_METHOD(transcribe, noteID:(NSString *)noteID modelID:(NSString *)modelID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *note = [self noteWithID:noteID];
  if (![self isSupportedModelID:modelID]) { reject(@"UNKNOWN_MODEL", @"This Whisper model is not available.", nil); return; }
  NSURL *model = [self modelURL:modelID];
  if (!note) { reject(@"NOTE_NOT_FOUND", @"This note no longer exists.", nil); return; }
  if (![[NSFileManager defaultManager] fileExistsAtPath:model.path]) { reject(@"MODEL_NOT_INSTALLED", @"Download the selected Whisper model first.", nil); return; }
  if (self.activeTranscriptionID) { reject(@"ALREADY_TRANSCRIBING", @"Finish or cancel the current transcription before starting another.", nil); return; }
  NSString *previousStatus = note[@"status"];
  TranscriptionCancellation *cancellation = [TranscriptionCancellation new];
  cancellation.noteID = noteID;
  cancellation.module = self;
  self.activeTranscriptions[noteID] = cancellation;
  self.activeTranscriptionID = noteID;
  self.activeTranscriptionModelID = modelID;
  note[@"status"] = @"transcribing";
  [self saveNotes];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [self emitTranscriptionStage:@"Preparing audio…" noteID:noteID];
    NSError *sampleError;
    NSData *sampleData = [self samplesForURL:[NSURL fileURLWithPath:note[@"audioPath"]] cancellation:cancellation error:&sampleError];
    if (!sampleData) { dispatch_async(dispatch_get_main_queue(), ^{
      [self.activeTranscriptions removeObjectForKey:noteID];
      self.activeTranscriptionID = nil;
      self.activeTranscriptionModelID = nil;
      note[@"status"] = previousStatus;
      [self saveNotes];
      if (cancellation.isCancelled) resolve(note); else reject(@"AUDIO_CONVERSION_FAILED", sampleError.localizedDescription ?: @"Unable to prepare the audio.", sampleError);
    }); return; }
    float *samples = (float *)sampleData.bytes;
    int sampleCount = (int)(sampleData.length / sizeof(float));
    [self emitTranscriptionStage:@"Loading Whisper model…" noteID:noteID];
    struct whisper_context_params contextParams = whisper_context_default_params();
    contextParams.use_gpu = true;
    struct whisper_context *context = whisper_init_from_file_with_params(model.fileSystemRepresentation, contextParams);
    if (!context) { dispatch_async(dispatch_get_main_queue(), ^{
      [self.activeTranscriptions removeObjectForKey:noteID];
      self.activeTranscriptionID = nil;
      self.activeTranscriptionModelID = nil;
      note[@"status"] = previousStatus;
      [self saveNotes];
      if (cancellation.isCancelled) resolve(note); else reject(@"MODEL_LOAD_FAILED", @"The downloaded Whisper model could not be opened.", nil);
    }); return; }
    if (cancellation.isCancelled) { whisper_free(context); dispatch_async(dispatch_get_main_queue(), ^{
      [self.activeTranscriptions removeObjectForKey:noteID];
      self.activeTranscriptionID = nil;
      self.activeTranscriptionModelID = nil;
      note[@"status"] = previousStatus;
      [self saveNotes];
      resolve(note);
    }); return; }
    struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.language = [modelID isEqualToString:@"small.en"] ? "en" : "auto";
    params.abort_callback = shouldAbortTranscription;
    params.abort_callback_user_data = (__bridge void *)cancellation;
    params.progress_callback = reportTranscriptionProgress;
    params.progress_callback_user_data = (__bridge void *)cancellation;
    [self emitTranscriptionStage:@"Transcribing 0%" noteID:noteID];
    int result = whisper_full(context, params, samples, sampleCount);
    NSMutableArray *segments = [NSMutableArray array];
    NSMutableString *text = [NSMutableString string];
    if (result == 0) for (int index = 0; index < whisper_full_n_segments(context); index++) {
      NSString *segment = [NSString stringWithUTF8String:whisper_full_get_segment_text(context, index)] ?: @"";
      [text appendString:segment];
      [segments addObject:@{ @"start": @(whisper_full_get_segment_t0(context, index) * 10), @"end": @(whisper_full_get_segment_t1(context, index) * 10), @"text": segment }];
    }
    whisper_free(context);
    dispatch_async(dispatch_get_main_queue(), ^{
      [self.activeTranscriptions removeObjectForKey:noteID];
      self.activeTranscriptionID = nil;
      self.activeTranscriptionModelID = nil;
      if (cancellation.isCancelled) {
        note[@"status"] = previousStatus;
        [self saveNotes];
        resolve(note);
        return;
      }
      note[@"status"] = result == 0 ? @"complete" : previousStatus;
      if (result == 0) {
        note[@"transcript"] = text;
        note[@"segments"] = segments;
        note[@"modelID"] = modelID;
        [note removeObjectForKey:@"summary"];
        [note removeObjectForKey:@"mainPoints"];
      }
      [self saveNotes];
      if (result == 0) resolve(note); else reject(@"TRANSCRIPTION_FAILED", @"Whisper could not transcribe this recording.", nil);
    });
  });
}

RCT_REMAP_METHOD(cancelTranscription, cancelNoteID:(NSString *)noteID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  TranscriptionCancellation *cancellation = self.activeTranscriptions[noteID];
  if (!cancellation) { resolve(@NO); return; }
  cancellation.cancelled = YES;
  resolve(@YES);
}

- (BOOL)isStudyPointsHeading:(NSString *)line {
  static NSRegularExpression *headingExpression;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    headingExpression = [NSRegularExpression regularExpressionWithPattern:@"^(?:#{1,6}\\s*)?(?:\\*{1,2}\\s*)?(?:(?:main|study|key)\\s+)?(?:points?|takeaways)\\s*:?(?:\\s*\\*{1,2})?\\s*:?$" options:NSRegularExpressionCaseInsensitive error:nil];
  });
  NSRange range = NSMakeRange(0, line.length);
  return [headingExpression firstMatchInString:line options:0 range:range] != nil;
}

- (BOOL)isSummaryHeading:(NSString *)line {
  static NSRegularExpression *headingExpression;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    headingExpression = [NSRegularExpression regularExpressionWithPattern:@"^(?:#{1,6}\\s*)?(?:\\*{1,2}\\s*)?summary\\s*:?(?:\\s*\\*{1,2})?\\s*:?$" options:NSRegularExpressionCaseInsensitive error:nil];
  });
  NSRange range = NSMakeRange(0, line.length);
  return [headingExpression firstMatchInString:line options:0 range:range] != nil;
}

- (NSString *)studyPointFromLine:(NSString *)line {
  static NSRegularExpression *bulletExpression;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    bulletExpression = [NSRegularExpression regularExpressionWithPattern:@"^(?:[-*•]\\s+|\\d+[.)]\\s+)(.+)$" options:0 error:nil];
  });
  NSTextCheckingResult *match = [bulletExpression firstMatchInString:line options:0 range:NSMakeRange(0, line.length)];
  if (!match) return nil;
  NSString *point = [line substringWithRange:[match rangeAtIndex:1]];
  return [point stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

- (NSArray<NSString *> *)studyPointsFromGeneratedText:(NSString *)generatedText {
  NSMutableArray<NSString *> *mainPoints = [NSMutableArray array];
  NSMutableSet<NSString *> *seenPoints = [NSMutableSet set];
  for (NSString *line in [generatedText componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSString *trimmedLine = [line stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSString *point = [self studyPointFromLine:trimmedLine];
    if (point.length > 0 && ![seenPoints containsObject:point.lowercaseString]) {
      [mainPoints addObject:point];
      [seenPoints addObject:point.lowercaseString];
    }
  }
  return mainPoints;
}

- (NSArray<NSString *> *)fallbackStudyPointsFromSummary:(NSString *)summary {
  NSMutableArray<NSString *> *mainPoints = [NSMutableArray array];
  NSMutableSet<NSString *> *seenPoints = [NSMutableSet set];
  NSRange range = NSMakeRange(0, summary.length);
  [summary enumerateSubstringsInRange:range options:NSStringEnumerationBySentences usingBlock:^(NSString *sentence, NSRange sentenceRange, NSRange enclosingRange, BOOL *stop) {
    NSString *point = [sentence stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (point.length < 12 || [self isSummaryHeading:point] || [self isStudyPointsHeading:point]) return;
    if (![seenPoints containsObject:point.lowercaseString]) {
      [mainPoints addObject:point];
      [seenPoints addObject:point.lowercaseString];
    }
    if (mainPoints.count == 5) *stop = YES;
  }];
  return mainPoints;
}

- (BOOL)saveGeneratedSummary:(NSString *)generatedSummary forNote:(NSMutableDictionary *)note error:(NSError **)error {
  NSMutableArray<NSString *> *summaryLines = [NSMutableArray array];
  NSArray<NSString *> *mainPoints = [self studyPointsFromGeneratedText:generatedSummary];
  for (NSString *line in [generatedSummary componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSString *trimmedLine = [line stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if ([self isSummaryHeading:trimmedLine] || [self isStudyPointsHeading:trimmedLine] || [self studyPointFromLine:trimmedLine]) {
      continue;
    }
    [summaryLines addObject:line];
  }
  NSString *summary = [[summaryLines componentsJoinedByString:@"\n"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (summary.length == 0 && mainPoints.count > 0) {
    summary = [mainPoints componentsJoinedByString:@" "];
  }
  if (summary.length == 0) {
    if (error) *error = [NSError errorWithDomain:@"LectureScribe.Summary" code:1 userInfo:@{ NSLocalizedDescriptionKey: @"The summary model did not return usable summary text." }];
    return NO;
  }
  if (mainPoints.count == 0) {
    mainPoints = [self fallbackStudyPointsFromSummary:summary];
  }
  note[@"summary"] = summary;
  note[@"mainPoints"] = mainPoints;
  return YES;
}

RCT_REMAP_METHOD(summarize, summarizeNoteID:(NSString *)noteID modelID:(NSString *)modelID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *note = [self noteWithID:noteID];
  if (!note) { reject(@"NOTE_NOT_FOUND", @"This note no longer exists.", nil); return; }
  if (![self isSupportedSummaryModelID:modelID]) { reject(@"UNKNOWN_SUMMARY_MODEL", @"This summary model is not available.", nil); return; }
  NSString *transcript = note[@"transcript"];
  if (transcript.length == 0) { reject(@"NO_TRANSCRIPT", @"Transcribe this note before creating study notes.", nil); return; }
  if (![[NSFileManager defaultManager] fileExistsAtPath:[self summaryModelURL:modelID].path]) { reject(@"SUMMARY_MODEL_NOT_INSTALLED", @"Download the selected summary model first.", nil); return; }
  if (self.activeSummaryID) { reject(@"ALREADY_SUMMARIZING", @"Finish the current summary before starting another.", nil); return; }
  self.activeSummaryID = noteID;
  self.activeSummaryModelID = modelID;
  transcript = [transcript copy];
  NSURL *modelURL = [self summaryModelURL:modelID];
  NSString *modelName = [self summaryModelForID:modelID][@"name"];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    LlamaSummarizer *summarizer = [LlamaSummarizer new];
    NSError *summaryError;
    NSString *generatedSummary = [summarizer summarizeTranscript:transcript modelURL:modelURL modelName:modelName progress:^(NSString *stage) {
      [self emitSummaryStage:stage noteID:noteID];
    } error:&summaryError];
    dispatch_async(dispatch_get_main_queue(), ^{
      self.activeSummaryID = nil;
      self.activeSummaryModelID = nil;
      if (!generatedSummary) { reject(@"SUMMARY_FAILED", summaryError.localizedDescription ?: @"Unable to create study notes.", summaryError); return; }
      NSError *formatError;
      if (![self saveGeneratedSummary:generatedSummary forNote:note error:&formatError]) {
        reject(@"SUMMARY_FORMAT_FAILED", formatError.localizedDescription, formatError);
        return;
      }
      [self saveNotes];
      resolve(note);
    });
  });
}

@end
