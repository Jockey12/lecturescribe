#import "LlamaSummarizer.h"
#import <llama/llama.h>

#include <cstring>
#include <string>
#include <vector>

static NSError *LlamaError(NSString *message) {
  return [NSError errorWithDomain:@"LectureScribe.Llama" code:1 userInfo:@{NSLocalizedDescriptionKey: message}];
}

static std::vector<llama_token> Tokenize(const llama_vocab *vocab, const std::string &text) {
  std::vector<llama_token> tokens(text.size() + 1);
  int32_t count = llama_tokenize(vocab, text.c_str(), (int32_t)text.size(), tokens.data(), (int32_t)tokens.size(), true, true);
  if (count < 0) {
    tokens.resize(-count);
    count = llama_tokenize(vocab, text.c_str(), (int32_t)text.size(), tokens.data(), (int32_t)tokens.size(), true, true);
  }
  if (count < 0) return {};
  tokens.resize(count);
  return tokens;
}

static std::string TokenPiece(const llama_vocab *vocab, llama_token token) {
  std::vector<char> piece(256);
  int32_t count = llama_token_to_piece(vocab, token, piece.data(), (int32_t)piece.size(), 0, false);
  if (count < 0) {
    piece.resize(-count);
    count = llama_token_to_piece(vocab, token, piece.data(), (int32_t)piece.size(), 0, false);
  }
  return count > 0 ? std::string(piece.data(), count) : std::string();
}

@implementation LlamaSummarizer

- (NSString *)generateStudyMaterialForTranscript:(NSString *)transcript
                                     instructions:(NSString *)instructions
                                         modelURL:(NSURL *)modelURL
                                        modelName:(NSString *)modelName
                                         progress:(LlamaProgressHandler)progress
                                            error:(NSError **)error {
  static dispatch_once_t backendOnce;
  dispatch_once(&backendOnce, ^{ llama_backend_init(); });

  if (progress) progress([NSString stringWithFormat:@"Loading %@…", modelName]);
  llama_model_params modelParams = llama_model_default_params();
  modelParams.n_gpu_layers = -1;
  llama_model *model = llama_model_load_from_file(modelURL.fileSystemRepresentation, modelParams);
  if (!model) {
    if (error) *error = LlamaError(@"The selected summary model could not be opened.");
    return nil;
  }

  llama_context_params contextParams = llama_context_default_params();
  contextParams.n_ctx = 16384;
  contextParams.n_batch = 512;
  contextParams.n_threads = (int32_t)NSProcessInfo.processInfo.activeProcessorCount;
  contextParams.n_threads_batch = contextParams.n_threads;
  llama_context *context = llama_init_from_model(model, contextParams);
  if (!context) {
    llama_model_free(model);
    if (error) *error = LlamaError(@"The selected summary context could not be created.");
    return nil;
  }

  const llama_vocab *vocab = llama_model_get_vocab(model);
  NSString *systemMessage = @"You turn lecture transcripts into accurate study aids. Use only information stated or clearly explained in the transcript. Do not invent facts, examples, names, or definitions.";
  NSString *userMessage = [NSString stringWithFormat:@"%@\n\nTranscript:\n%@", instructions, transcript];
  const char *systemUTF8 = systemMessage.UTF8String;
  const char *userUTF8 = userMessage.UTF8String;
  const char *chatTemplate = llama_model_chat_template(model, nullptr);
  if (!systemUTF8 || !userUTF8 || !chatTemplate) {
    llama_free(context);
    llama_model_free(model);
    if (error) *error = LlamaError(@"The selected summary model could not prepare a chat prompt.");
    return nil;
  }
  llama_chat_message messages[] = {
    { "system", systemUTF8 },
    { "user", userUTF8 },
  };
  int32_t promptLength = llama_chat_apply_template(chatTemplate, messages, 2, true, nullptr, 0);
  if (promptLength <= 0) {
    llama_free(context);
    llama_model_free(model);
    if (error) *error = LlamaError(@"The selected summary model could not format a chat prompt.");
    return nil;
  }
  std::vector<char> promptBuffer(promptLength + 1);
  if (llama_chat_apply_template(chatTemplate, messages, 2, true, promptBuffer.data(), (int32_t)promptBuffer.size()) <= 0) {
    llama_free(context);
    llama_model_free(model);
    if (error) *error = LlamaError(@"The selected summary model could not format a chat prompt.");
    return nil;
  }
  std::vector<llama_token> tokens = Tokenize(vocab, std::string(promptBuffer.data(), promptLength));
  const int32_t maxGeneratedTokens = 768;
  if (tokens.empty() || tokens.size() + maxGeneratedTokens > llama_n_ctx(context)) {
    llama_free(context);
    llama_model_free(model);
    if (error) *error = LlamaError(@"This transcript is too long to summarize in one local pass.");
    return nil;
  }

  if (progress) progress(@"Reading transcript…");
  for (size_t position = 0; position < tokens.size(); position += contextParams.n_batch) {
    int32_t batchSize = (int32_t)std::min((size_t)contextParams.n_batch, tokens.size() - position);
    llama_batch batch = llama_batch_get_one(tokens.data() + position, batchSize);
    if (llama_decode(context, batch) != 0) {
      llama_free(context);
      llama_model_free(model);
      if (error) *error = LlamaError(@"The selected summary model could not process this transcript.");
      return nil;
    }
  }

  if (progress) progress(@"Writing study notes…");
  llama_sampler *sampler = llama_sampler_init_greedy();
  std::string output;
  for (int32_t index = 0; index < maxGeneratedTokens; index++) {
    llama_token token = llama_sampler_sample(sampler, context, -1);
    if (llama_vocab_is_eog(vocab, token)) break;
    output += TokenPiece(vocab, token);
    llama_sampler_accept(sampler, token);
    llama_batch batch = llama_batch_get_one(&token, 1);
    if (llama_decode(context, batch) != 0) break;
  }
  llama_sampler_free(sampler);
  llama_free(context);
  llama_model_free(model);

  NSString *summary = [[NSString alloc] initWithBytes:output.data() length:output.size() encoding:NSUTF8StringEncoding];
  if (summary.length == 0) {
    if (error) *error = LlamaError(@"The selected summary model did not generate a summary.");
    return nil;
  }
  if (progress) progress(@"Summary complete");
  return [summary stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

- (NSString *)summarizeTranscript:(NSString *)transcript
                         modelURL:(NSURL *)modelURL
                         modelName:(NSString *)modelName
                         progress:(LlamaProgressHandler)progress
                            error:(NSError **)error {
  NSString *instructions = @"Create study notes from the transcript below. Return only this structure, with no preface or closing text:\n\nStudy points:\n- Write 5 to 8 distinct, specific takeaways that are useful to review for an exam.\n- Keep each takeaway to one sentence of 25 words or fewer.\n- Prefer definitions, relationships, processes, claims, caveats, and named concepts stated in the transcript.\n\nSummary:\nWrite one concise paragraph of no more than 120 words covering the lecture's central idea and supporting concepts.";
  return [self generateStudyMaterialForTranscript:transcript instructions:instructions modelURL:modelURL modelName:modelName progress:progress error:error];
}

@end
