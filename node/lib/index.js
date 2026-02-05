'use strict';

const path = require('node:path');

let addon;
try {
    addon = require('../build/Release/piper_node.node');
} catch {
    try {
        addon = require('../build/Debug/piper_node.node');
    } catch {
        throw new Error(
            'Failed to load piper native addon. Run "npm run build" to compile.'
        );
    }
}

const NativePiperSynthesizer = addon.PiperSynthesizer;
const ESPEAK_DATA_PATH = path.join(__dirname, '..', 'espeak-ng-data');

class PiperSynthesizer {
    #native;

    /**
     * Create a Piper text-to-speech synthesizer.
     *
     * @param {string} modelPath - Path to the ONNX voice model file.
     * @param {object} [options]
     * @param {string} [options.configPath] - Path to the JSON voice config file.
     *   Defaults to modelPath + ".json".
     * @param {string} [options.espeakDataPath] - Path to the espeak-ng data directory.
     *   Defaults to the bundled data.
     */
    constructor(modelPath, options = {}) {
        if (typeof modelPath !== 'string') {
            throw new TypeError('modelPath must be a string');
        }

        const configPath = options.configPath ?? null;
        const espeakDataPath = options.espeakDataPath ?? ESPEAK_DATA_PATH;

        this.#native = new NativePiperSynthesizer(
            modelPath,
            configPath,
            espeakDataPath
        );
    }

    /**
     * Get the default synthesis options from the voice model config.
     *
     * @returns {{ speakerId: number, lengthScale: number, noiseScale: number, noiseWScale: number }}
     */
    getDefaultOptions() {
        return this.#native.getDefaultOptions();
    }

    /**
     * Synthesize text into audio chunks.
     *
     * Returns one audio chunk per sentence. Each chunk contains raw float32
     * audio samples along with phoneme and alignment data.
     *
     * @param {string} text - Text to synthesize.
     * @param {object} [options]
     * @param {number} [options.speakerId] - Speaker ID for multi-speaker models.
     * @param {number} [options.lengthScale] - Speech tempo (0.5 = 2x faster, 2.0 = 2x slower).
     * @param {number} [options.noiseScale] - Voice quality noise.
     * @param {number} [options.noiseWScale] - Phoneme width variation noise.
     * @returns {AudioChunk[]}
     */
    synthesize(text, options) {
        return this.#native.synthesize(text, options);
    }

    /**
     * Free resources held by the synthesizer.
     *
     * After calling dispose, the synthesizer can no longer be used.
     */
    dispose() {
        this.#native.dispose();
    }
}

/**
 * Convert an array of audio chunks into a WAV file buffer.
 *
 * @param {AudioChunk[]} chunks - Audio chunks from synthesize().
 * @returns {Buffer} WAV file contents.
 */
function chunksToWavBuffer(chunks) {
    if (!chunks || chunks.length === 0) {
        throw new Error('No audio chunks provided');
    }

    const sampleRate = chunks[0].sampleRate;

    // Count total samples
    let totalSamples = 0;
    for (const chunk of chunks) {
        totalSamples += chunk.samples.length;
    }

    // Convert float32 samples to int16 PCM
    const pcmData = Buffer.alloc(totalSamples * 2);
    let offset = 0;
    for (const chunk of chunks) {
        const samples = chunk.samples;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            const val = s < 0 ? s * 32768 : s * 32767;
            pcmData.writeInt16LE(Math.round(val), offset);
            offset += 2;
        }
    }

    // Build WAV header
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const headerSize = 44;

    const header = Buffer.alloc(headerSize);
    header.write('RIFF', 0);
    header.writeUInt32LE(dataSize + headerSize - 8, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
}

/**
 * Convert float32 audio samples to int16 PCM.
 *
 * @param {Float32Array} samples - Audio samples in [-1, 1] range.
 * @returns {Int16Array} Audio samples as signed 16-bit integers.
 */
function samplesToInt16(samples) {
    const int16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = Math.round(s < 0 ? s * 32768 : s * 32767);
    }
    return int16;
}

module.exports = { PiperSynthesizer, chunksToWavBuffer, samplesToInt16 };
