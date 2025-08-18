# Chunked MP3 Generation

## Overview

The Edge TTS plugin now supports **chunked MP3 generation** for long notes that exceed the standard processing limits. This feature automatically splits long content into manageable chunks, generates audio for each chunk, and combines them into a single MP3 file.

## Content Limits

The plugin enforces absolute maximum limits for MP3 generation to ensure reliable performance:

-   **Maximum Words**: 5,000 words
-   **Maximum Characters**: 30,000 characters

If your content exceeds these limits, the plugin will:

1. Automatically truncate the content at a smart boundary (sentence or word break)
2. Show a notice explaining what happened
3. Proceed with MP3 generation using the truncated content

These limits are not user-configurable and apply to all MP3 generation methods (regular, chunked, and force chunked).

## When is Chunked Generation Used?

Chunked generation is automatically triggered when:

-   A note's text exceeds **4,096 bytes** after text filtering and processing

Note: Even with chunked generation, the absolute maximum limits above still apply.

## How It Works

1. **Content Validation**: Check if content exceeds absolute maximum limits and truncate if necessary
2. **Text Splitting**: The note content is intelligently split into chunks, preserving sentence and paragraph boundaries when possible
3. **Chunk Processing**: Each chunk is processed individually using the Edge TTS service
4. **Progress Tracking**: A visual progress indicator shows the status of each chunk
5. **Audio Combination**: All successfully generated chunks are combined into a single MP3 file

## Progress Indicator

When chunked generation is active, you'll see a progress indicator positioned above the status bar in the bottom-right corner of Obsidian. This indicator shows:

-   **Current Phase**: Splitting, Generating, Combining, or Completed
-   **Overall Progress**: Percentage of completion
-   **Chunk Status**: Individual progress for each chunk with visual indicators
-   **Note Title**: The name of the note being processed
-   **Truncation Notice**: If content was truncated due to limits

### Chunk Status Icons

-   🕒 **Pending**: Waiting to be processed
-   ⚙️ **Processing**: Currently generating audio (with progress percentage)
-   ✅ **Completed**: Successfully generated
-   ❌ **Failed**: Error occurred during generation

## Configuration

### Chunk Size

Chunk size is now fixed at **4,096 bytes** per chunk due to API limitations:

-   **Fixed Size**: 4,096 bytes (with 100-byte safety buffer = 3,996 effective bytes)
-   **Not Configurable**: This limit is enforced by the TTS API and cannot be changed by users
-   **Byte-Based**: Chunking is now based on byte size rather than character count for accurate API compliance

### Commands

-   **Generate MP3**: Automatically uses chunked generation for long notes
-   **Force chunked MP3 generation**: Manually trigger chunked generation for any note (useful for testing)

## Error Handling

The chunked generation system is designed to be resilient:

-   If a chunk fails to generate, the process continues with remaining chunks
-   Failed chunks are visually indicated in the progress display
-   The final MP3 will contain all successfully generated chunks
-   Detailed error messages are shown for troubleshooting

## Performance Considerations

-   **Processing Time**: Chunked generation takes longer than standard generation due to sequential processing
-   **Memory Usage**: Lower memory usage compared to processing very long texts as single units
-   **Network**: Each chunk requires a separate API call to the Edge TTS service
-   **Rate Limiting**: A 500ms delay is added between chunks to avoid overwhelming the service
-   **Content Limits**: Very large documents may be truncated to stay within the 5,000 word / 30,000 character limits

## Tips for Best Results

1. **Optimize Content**: Remove unnecessary formatting and content before generation
2. **Adjust Chunk Size**: Use smaller chunks for very long documents or if experiencing failures
3. **Monitor Progress**: The progress indicator provides real-time feedback on generation status
4. **Error Recovery**: If some chunks fail, you can retry generation or manually split the content
5. **Content Length**: Be aware of the absolute maximum limits - consider splitting very long documents into separate notes

## Troubleshooting

### Common Issues

1. **Content Truncated**: Your note exceeds 5,000 words or 30,000 characters - consider splitting into multiple notes
2. **Timeout Errors**: Chunks are now optimized at 4,096 bytes for better reliability
3. **Network Issues**: Check your internet connection and retry
4. **Memory Issues**: Close other applications (chunks are now optimized for memory usage)
5. **Service Limits**: The Edge TTS service may have daily or hourly limits

### Getting Help

If you encounter persistent issues with chunked generation:

1. Check the browser console for detailed error messages
2. Test with the "Force chunked MP3 generation" command on smaller text
3. Verify your content doesn't exceed the 5,000 word / 30,000 character limits
4. Consider splitting very long content into multiple notes
5. Report issues on the plugin's GitHub repository

## Technical Details

-   **Content Limits**: 5,000 words or 30,000 characters maximum (enforced before processing)
-   **Text Processing**: Content is filtered and cleaned before chunking
-   **Chunk Size**: Fixed at 4,096 bytes per chunk (3,996 effective bytes with safety buffer)
-   **Chunk Boundaries**: Attempts to split at paragraph and sentence boundaries while respecting byte limits
-   **Audio Format**: Uses MP3 format for maximum compatibility
-   **Combination Method**: Simple concatenation of MP3 buffers
-   **Error Recovery**: Graceful handling of partial failures
-   **Smart Truncation**: When content exceeds limits, truncation occurs at sentence or word boundaries
-   **API Compliance**: Byte-based chunking ensures compliance with TTS API 4,096-byte limit
