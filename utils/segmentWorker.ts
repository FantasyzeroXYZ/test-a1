
// 这是一个独立的 Worker 脚本逻辑
self.onmessage = (e) => {
  const { channelData, sampleRate, threshold, minSilenceSeconds, minPhraseSeconds } = e.data;
  
  const segments = [];
  const stepSeconds = 0.05; // 每 50ms 采样一次能量
  const stepSize = Math.floor(sampleRate * stepSeconds);
  
  let isSpeech = false;
  let speechStart = 0;
  let silenceStart = 0;

  // 能量检测循环
  for (let i = 0; i < channelData.length; i += stepSize) {
    let sum = 0;
    const end = Math.min(i + stepSize, channelData.length);
    const actualStep = end - i;
    
    // 计算当前窗口的 RMS 能量
    for (let j = i; j < end; j++) {
      sum += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sum / actualStep);
    const currentTime = i / sampleRate;

    if (rms > threshold) {
      if (!isSpeech) {
        isSpeech = true;
        speechStart = currentTime;
      }
      silenceStart = 0;
    } else {
      if (isSpeech) {
        if (silenceStart === 0) silenceStart = currentTime;
        
        // 静音持续时间超过阈值，记录段落
        if (currentTime - silenceStart >= minSilenceSeconds) {
          const duration = silenceStart - speechStart;
          if (duration >= minPhraseSeconds) {
            segments.push({
              id: `auto-${segments.length}-${Date.now()}`,
              start: speechStart,
              end: silenceStart,
              text: ""
            });
          }
          isSpeech = false;
          silenceStart = 0;
        }
      }
    }

    // 定期向主线程发送进度（可选，此处暂略）
  }

  // 扫尾处理
  if (isSpeech) {
    segments.push({
      id: `auto-${segments.length}-${Date.now()}`,
      start: speechStart,
      end: channelData.length / sampleRate,
      text: ""
    });
  }

  self.postMessage({ segments });
};
