
// Helper to convert Blob to Base64
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Main function to extract clip via playback recording
export const extractAudioClip = async (file: File, startTime: number, endTime: number): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      
      // Safety timeout to prevent infinite hanging
      const MAX_RECORD_TIME = 20000; // 20 seconds max
      const failTimeout = setTimeout(() => {
          console.warn("Audio extraction timed out");
          cleanup();
          resolve("");
      }, MAX_RECORD_TIME);

      let isResolved = false;
      let recorder: MediaRecorder | null = null;
      let reqId: number;

      const cleanup = () => {
          if (isResolved) return;
          isResolved = true;
          clearTimeout(failTimeout);
          cancelAnimationFrame(reqId);
          
          if (recorder && recorder.state !== 'inactive') {
              recorder.stop();
          }
          
          audio.pause();
          audio.src = "";
          URL.revokeObjectURL(url);
          
          // Clear all handlers
          audio.oncanplaythrough = null;
          audio.onseeked = null;
          audio.onerror = null;
      };

      const safeResolve = (val: string) => {
          cleanup();
          resolve(val);
      };

      // Load audio
      audio.preload = 'auto'; 
      audio.muted = false; // Must be unmuted to capture stream
      audio.crossOrigin = "anonymous";

      // Cross-browser captureStream
      const stream = (audio as any).captureStream ? (audio as any).captureStream() : 
                     (audio as any).mozCaptureStream ? (audio as any).mozCaptureStream() : null;

      if (!stream) {
        console.warn("captureStream not supported");
        safeResolve(""); 
        return;
      }

      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        try {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            if (blob.size === 0) {
                console.warn("Empty audio blob");
                safeResolve("");
                return;
            }
            const base64 = await blobToBase64(blob);
            safeResolve(base64);
        } catch (e) {
            console.error("Blob conversion failed", e);
            safeResolve("");
        }
      };

      recorder.onerror = () => {
          safeResolve("");
      };

      const checkTime = () => {
          if (isResolved) return;

          if (audio.currentTime >= endTime || audio.paused || audio.ended) {
              if (recorder && recorder.state === 'recording') {
                  recorder.stop();
                  audio.pause();
              } else if (audio.ended) {
                  safeResolve(""); 
              }
          } else {
              reqId = requestAnimationFrame(checkTime);
          }
      };

      const startRecording = async () => {
          try {
              if (recorder && recorder.state === 'inactive') {
                  recorder.start();
                  await audio.play();
                  reqId = requestAnimationFrame(checkTime);
              }
          } catch (e) {
              console.error("Recording start failed", e);
              safeResolve("");
          }
      };

      // Event Chain: canplaythrough -> seek -> seeked -> record
      const onSeeked = () => {
          audio.removeEventListener('seeked', onSeeked);
          startRecording();
      };

      const onCanPlay = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.addEventListener('seeked', onSeeked);
          audio.currentTime = startTime;
      };

      audio.addEventListener('canplaythrough', onCanPlay);
      
      audio.onerror = (e) => {
          console.error("Audio error", e);
          safeResolve("");
      };

    } catch (e) {
      console.error("Audio recording setup failed", e);
      resolve("");
    }
  });
};
