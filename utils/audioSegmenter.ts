
import { SubtitleLine } from '../types';

/**
 * 扫描音频缓存并检测非静音段落
 * @param audioBuffer 浏览器解码后的音频缓冲
 * @param threshold 能量阈值 (0-1)，通常 0.01 - 0.05
 * @param minSilenceSeconds 最小静音长度，用于判定断句
 * @param minPhraseSeconds 最小段落长度，过滤噪音
 */
export const detectAudioSegments = (
  audioBuffer: AudioBuffer,
  threshold: number = 0.02,
  minSilenceSeconds: number = 0.4,
  minPhraseSeconds: number = 0.2
): SubtitleLine[] => {
  const sampleRate = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0); // 取单声道分析
  const segments: SubtitleLine[] = [];
  
  const stepSeconds = 0.05; // 每 50ms 采样一次能量
  const stepSize = Math.floor(sampleRate * stepSeconds);
  
  let isSpeech = false;
  let speechStart = 0;
  let silenceStart = 0;

  for (let i = 0; i < data.length; i += stepSize) {
    // 计算当前窗口的 RMS 能量
    let sum = 0;
    const end = Math.min(i + stepSize, data.length);
    for (let j = i; j < end; j++) {
      sum += data[j] * data[j];
    }
    const rms = Math.sqrt(sum / stepSize);
    const currentTime = i / sampleRate;

    if (rms > threshold) {
      // 正在说话
      if (!isSpeech) {
        isSpeech = true;
        speechStart = currentTime;
      }
      silenceStart = 0;
    } else {
      // 处于静音
      if (isSpeech) {
        if (silenceStart === 0) silenceStart = currentTime;
        
        // 如果静音持续时间超过设定，则断句
        if (currentTime - silenceStart >= minSilenceSeconds) {
          const duration = silenceStart - speechStart;
          if (duration >= minPhraseSeconds) {
            segments.push({
              id: `auto-${segments.length}`,
              start: speechStart,
              end: silenceStart,
              text: "" // 自动生成的段落没有文本内容
            });
          }
          isSpeech = false;
          silenceStart = 0;
        }
      }
    }
  }

  // 处理最后一段
  if (isSpeech) {
    segments.push({
      id: `auto-${segments.length}`,
      start: speechStart,
      end: audioBuffer.duration,
      text: ""
    });
  }

  return segments;
};
