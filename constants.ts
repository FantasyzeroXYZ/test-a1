
// Add generic audio types and specific mime types for iOS compatibility
export const SUPPORTED_AUDIO_TYPES = "audio/*, .m4b, .mp3, .m4a, .wav, audio/mp4, audio/mpeg, audio/x-m4b, audio/wav, audio/x-wav, audio/aac";
// Add text mime types for iOS compatibility with subtitle files
export const SUPPORTED_SUBTITLE_TYPES = ".srt, .lrc, .vtt, .ass, text/plain, text/vtt, application/x-subrip, text/srt";

// Mock data if needed, but we rely on file uploads
export const MOCK_SUBTITLES = [];

export const DEFAULT_KEY_BINDINGS = {
  playPause: 'Space',
  rewind: 'ArrowLeft',
  forward: 'ArrowRight',
  toggleSidebar: 'KeyS',
  toggleSubtitleMode: 'KeyD',
};
