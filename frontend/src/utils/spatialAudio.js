
const PIXELS_PER_METER = 100;

const MAX_DISTANCE = 8;

export function createSpatialAudio(audio) {
  if (!audio) {
    throw new Error("Audio element is required");
  }

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not supported");
  }

  const audioContext = new AudioContextClass();

  const source = audioContext.createMediaElementSource(audio);

  const panner = audioContext.createPanner();

  const gain = audioContext.createGain();

  // Spatial audio configuration
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";

  panner.refDistance = 1;
  panner.maxDistance = MAX_DISTANCE;
  panner.rolloffFactor = 1.5;

  // Initial position
  panner.positionX.value = 0;
  panner.positionY.value = 0;
  panner.positionZ.value = -1;

  // Audio volume
  gain.gain.value = 1;

  // Connect audio nodes
  source.connect(panner);
  panner.connect(gain);
  gain.connect(audioContext.destination);

  // Resume audio context when playback starts
  const resumeAudio = () => {
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(console.error);
    }
  };

  audio.addEventListener("play", resumeAudio);

  return {
    audio,
    audioContext,
    source,
    panner,
    gain,
    resumeAudio,
  };
}

export function updateSpatialAudio(
  spatialAudio,
  listenerPosition,
  remoteUserPosition
) {
  if (!spatialAudio || !listenerPosition || !remoteUserPosition) {
    return;
  }

  const { panner, audioContext } = spatialAudio;

  const currentTime = audioContext.currentTime;

  // Calculate distance between users
  const deltaX =
    remoteUserPosition.x - listenerPosition.x;

  const deltaY =
    remoteUserPosition.y - listenerPosition.y;

  // Convert canvas coordinates into audio coordinates
  const x = deltaX / PIXELS_PER_METER;
  const z = deltaY / PIXELS_PER_METER;

  // Smoothly update the 3D audio position
  panner.positionX.setTargetAtTime(
    x,
    currentTime,
    0.1
  );

  panner.positionY.setTargetAtTime(
    0,
    currentTime,
    0.1
  );

  panner.positionZ.setTargetAtTime(
    z,
    currentTime,
    0.1
  );
}
