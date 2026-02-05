
// Add generic audio types and specific mime types for iOS compatibility
// Expanded list to handle iOS Files app strictness
export const SUPPORTED_AUDIO_TYPES = "audio/*,.m4b,.mp3,.m4a,.wav,.aac,.flac,.ogg,audio/mp4,audio/mpeg,audio/x-m4b,audio/wav,audio/x-wav,audio/x-m4a,audio/aac,application/octet-stream";

// Add text mime types for iOS compatibility with subtitle files
// Added .txt and explicit text types to improve selection capability on iOS
export const SUPPORTED_SUBTITLE_TYPES = ".srt,.lrc,.vtt,.ass,.txt,text/plain,text/vtt,application/x-subrip,text/srt,application/octet-stream,text/x-vtt";

// Mock data if needed, but we rely on file uploads
export const MOCK_SUBTITLES = [];

export const DEFAULT_KEY_BINDINGS = {
  playPause: 'Space',
  rewind: 'ArrowLeft',
  forward: 'ArrowRight',
  toggleSidebar: 'KeyS',
  toggleSubtitleMode: 'KeyD',
};
