/**
 * Options for creating a Piper synthesizer.
 */
export interface PiperSynthesizerOptions {
    /**
     * Path to the JSON voice config file.
     * Defaults to modelPath + ".json".
     */
    configPath?: string;

    /**
     * Path to the espeak-ng data directory.
     * Defaults to the bundled data.
     */
    espeakDataPath?: string;
}

/**
 * Options for synthesis.
 */
export interface SynthesizeOptions {
    /** Speaker ID for multi-speaker models (default: 0). */
    speakerId?: number;

    /**
     * Speech tempo. A value of 0.5 means 2x faster, 2.0 means 2x slower.
     * Default depends on the voice model.
     */
    lengthScale?: number;

    /**
     * Controls noise added during synthesis.
     * Default depends on the voice model.
     */
    noiseScale?: number;

    /**
     * Controls how much phonemes vary in length.
     * Default depends on the voice model.
     */
    noiseWScale?: number;
}

/**
 * A chunk of synthesized audio.
 */
export interface AudioChunk {
    /** Raw audio samples from the voice model. */
    samples: Float32Array;

    /** Sample rate in Hertz. */
    sampleRate: number;

    /** True if this is the last audio chunk. */
    isLast: boolean;

    /**
     * Phoneme codepoints that produced this audio chunk.
     * Groups of repeated codepoints are separated by 0.
     */
    phonemes: Uint32Array | null;

    /** Phoneme IDs that produced this audio chunk. */
    phonemeIds: Int32Array | null;

    /**
     * Audio sample count for each phoneme ID (alignments).
     * Null if the voice model does not support alignments.
     */
    alignments: Int32Array | null;
}

/**
 * A Piper text-to-speech synthesizer.
 */
export class PiperSynthesizer {
    /**
     * Create a synthesizer from a voice model.
     *
     * @param modelPath - Path to the ONNX voice model file.
     * @param options - Synthesizer options.
     */
    constructor(modelPath: string, options?: PiperSynthesizerOptions);

    /**
     * Get the default synthesis options from the voice model config.
     */
    getDefaultOptions(): Required<SynthesizeOptions>;

    /**
     * Synthesize text into audio chunks.
     *
     * Returns one audio chunk per sentence.
     *
     * @param text - Text to synthesize.
     * @param options - Synthesis options.
     */
    synthesize(text: string, options?: SynthesizeOptions): AudioChunk[];

    /**
     * Free resources held by the synthesizer.
     *
     * After calling dispose, the synthesizer can no longer be used.
     */
    dispose(): void;
}

/**
 * Convert an array of audio chunks into a WAV file buffer.
 *
 * @param chunks - Audio chunks from synthesize().
 * @returns WAV file contents as a Buffer.
 */
export function chunksToWavBuffer(chunks: AudioChunk[]): Buffer;

/**
 * Convert float32 audio samples to int16 PCM.
 *
 * @param samples - Audio samples in [-1, 1] range.
 * @returns Audio samples as signed 16-bit integers.
 */
export function samplesToInt16(samples: Float32Array): Int16Array;
