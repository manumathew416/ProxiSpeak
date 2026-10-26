const MAX_AUDIBLE_DISTANCE = 100;
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

// Calculate distance between two avatars.
export function calculateDistance(user1, user2) {
    const dx = user1.x - user2.x;
    const dy = user1.y - user2.y;

    return Math.sqrt(dx * dx + dy * dy);
}

// Calculate audio volume based on distance.
export function calculateVolume(distance) {
    if (distance >= MAX_AUDIBLE_DISTANCE) {
        return MIN_VOLUME;
    }

    if (distance <= 0) {
        return MAX_VOLUME;
    }

    // Linear attenuation: closer means louder.
    return Math.max(
        MIN_VOLUME,
        Math.min(
            MAX_VOLUME,
            1 - distance / MAX_AUDIBLE_DISTANCE
        )
    );
}

// Apply volume to a remote audio element.
export function updateSpatialVolume(
    audioElement,
    localPosition,
    remotePosition
) {
    if (!audioElement) {
        return 0;
    }

    const distance = calculateDistance(
        localPosition,
        remotePosition
    );

    const volume = calculateVolume(distance);

    audioElement.volume = volume;

    return volume;
}