#import <Foundation/Foundation.h>

typedef void (^LlamaProgressHandler)(NSString *stage);

@interface LlamaSummarizer : NSObject
- (NSString *)summarizeTranscript:(NSString *)transcript
                          modelURL:(NSURL *)modelURL
                          modelName:(NSString *)modelName
                          progress:(LlamaProgressHandler)progress
                             error:(NSError **)error;
@end
