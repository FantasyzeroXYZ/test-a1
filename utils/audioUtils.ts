
// Helper to convert AudioBuffer to WAV
const bufferToWav = (abuffer: AudioBuffer) => {
    let numOfChan = abuffer.numberOfChannels,
        length = abuffer.length * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [],
        i, sample, offset = 0,
        pos = 0;
  
    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"
  
    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit (hardcoded in this parser)
  
    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length
  
    // write interleaved data
    for(i = 0; i < abuffer.numberOfChannels; i++)
      channels.push(abuffer.getChannelData(i));
  
    while(pos < abuffer.length) {
      for(i = 0; i < numOfChan; i++) {             // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
        view.setInt16(44 + offset, sample, true);          // write 16-bit sample
        offset += 2;
      }
      pos++;
    }
  
    return buffer;
  
    function setUint16(data: any) {
      view.setUint16(pos, data, true);
      pos += 2;
    }
  
    function setUint32(data: any) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  }
  
  // Main function to extract clip
  export const extractAudioClip = async (file: File, startTime: number, endTime: number): Promise<string> => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Calculate start and end frames
    const startFrame = Math.floor(startTime * audioBuffer.sampleRate);
    const endFrame = Math.floor(endTime * audioBuffer.sampleRate);
    const frameCount = endFrame - startFrame;
    
    if (frameCount <= 0) {
      console.warn("Attempted to extract an audio clip with non-positive frame count.", {startTime, endTime, frameCount, duration: audioBuffer.duration});
      return "";
    }
  
    // Create a new buffer for the clip
    const clipBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      frameCount,
      audioBuffer.sampleRate
    );
  
    // Copy data
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      const clipData = clipBuffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        const sourceIndex = startFrame + i;
        if (sourceIndex < channelData.length) { // Ensure we don't read past end of source buffer
            clipData[i] = channelData[sourceIndex];
        } else {
            clipData[i] = 0; // Fill with silence if source is shorter than expected
        }
      }
    }
  
    const wavBuffer = bufferToWav(clipBuffer);
    
    // Convert to Base64
    let binary = '';
    const bytes = new Uint8Array(wavBuffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:audio/wav;base64,${window.btoa(binary)}`; // Add data URI prefix
  };
