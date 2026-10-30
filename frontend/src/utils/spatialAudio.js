
const MAX_AUDIBLE_DISTANCE = 100;

export function calculateDistance(user1, user2) {
    const dx = user1.x - user2.x;
    const dy = user1.y - user2.y;

    return Math.sqrt(dx * dx + dy * dy);
}

export function calculateVolume(distance) {
    if (distance >= MAX_AUDIBLE_DISTANCE) return 0;
    if (distance <= 0) return 1;

    return 1 - distance / MAX_AUDIBLE_DISTANCE;
}

export function createSpatialAudio(audioElement) {
    const audioContext = new AudioContext();

    const source = audioContext.createMediaElementSource(audioElement);
    const gainNode = audioContext.createGain();
    const pannerNode = audioContext.createStereoPanner();

    source.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(audioContext.destination);

    return {
        audioContext,
        gainNode,
        pannerNode,
    };
}

export function updateSpatialAudio(
    spatialAudio,
    localPosition,
    remotePosition
) {
    if (!spatialAudio) return;

    const distance = calculateDistance(
        localPosition,
        remotePosition
    );

    const volume = calculateVolume(distance);

    // Left and right direction
    const horizontalDifference =
        remotePosition.x - localPosition.x;

    const pan = Math.max(
        -1,
        Math.min(1, horizontalDifference / MAX_AUDIBLE_DISTANCE)
    );

    spatialAudio.gainNode.gain.setTargetAtTime(
        volume,
        spatialAudio.audioContext.currentTime,
        0.05
    );

    spatialAudio.pannerNode.pan.setTargetAtTime(
        pan,
        spatialAudio.audioContext.currentTime,
        0.05
    );
}
