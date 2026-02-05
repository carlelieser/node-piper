import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PiperSynthesizer, chunksToWavBuffer, samplesToInt16 } from '../lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VOICE = path.join(__dirname, '..', '..', 'tests', 'test_voice.onnx');

describe('PiperSynthesizer', () => {
    let synth;

    afterEach(() => {
        if (synth) {
            synth.dispose();
            synth = null;
        }
    });

    it('should load a voice model', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        const defaults = synth.getDefaultOptions();

        assert.equal(defaults.speakerId, 0);
        assert.ok(Math.abs(defaults.lengthScale - 1.0) < 0.001);
        assert.ok(Math.abs(defaults.noiseScale - 0.667) < 0.001);
        assert.ok(Math.abs(defaults.noiseWScale - 0.8) < 0.001);
    });

    it('should synthesize two sentences into two chunks', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        const chunks = synth.synthesize('This is a test. This is another test.');

        // One chunk per sentence
        assert.equal(chunks.length, 2);

        for (const chunk of chunks) {
            assert.ok(chunk.samples instanceof Float32Array);
            assert.equal(chunk.sampleRate, 22050);
            assert.equal(typeof chunk.isLast, 'boolean');

            // Test voice produces 1 second of silence per sentence
            assert.equal(chunk.samples.length, 22050);

            // Verify silence
            for (let i = 0; i < chunk.samples.length; i++) {
                assert.equal(chunk.samples[i], 0);
            }
        }

        // First chunk is not last, second chunk is last
        assert.equal(chunks[0].isLast, false);
        assert.equal(chunks[1].isLast, true);
    });

    it('should include phoneme IDs in chunks', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        const chunks = synth.synthesize('Test.');

        assert.equal(chunks.length, 1);
        assert.ok(chunks[0].phonemeIds instanceof Int32Array);
        assert.ok(chunks[0].phonemeIds.length > 0);

        // Should start with BOS (1) and end with EOS (2)
        assert.equal(chunks[0].phonemeIds[0], 1); // BOS
        assert.equal(chunks[0].phonemeIds[chunks[0].phonemeIds.length - 1], 2); // EOS
    });

    it('should include phoneme codepoints in chunks', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        const chunks = synth.synthesize('Test.');

        assert.equal(chunks.length, 1);
        assert.ok(chunks[0].phonemes instanceof Uint32Array);
        assert.ok(chunks[0].phonemes.length > 0);
    });

    it('should accept synthesis options', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        const chunks = synth.synthesize('Test.', {
            speakerId: 0,
            lengthScale: 1.0,
            noiseScale: 0.667,
            noiseWScale: 0.8,
        });

        assert.equal(chunks.length, 1);
        assert.ok(chunks[0].samples instanceof Float32Array);
    });

    it('should return empty array for empty text', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        const chunks = synth.synthesize('');

        assert.equal(chunks.length, 0);
    });

    it('should throw after dispose', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        synth.dispose();

        assert.throws(() => synth.synthesize('Test.'), {
            message: /disposed/,
        });

        // Safe to dispose again
        synth.dispose();
        synth = null;
    });

    it('should throw for invalid model path', () => {
        assert.throws(
            () => new PiperSynthesizer('/nonexistent/model.onnx'),
            /Failed to create/
        );
    });

    it('should throw for missing arguments', () => {
        assert.throws(() => new PiperSynthesizer(), {
            name: 'TypeError',
        });
    });
});

describe('chunksToWavBuffer', () => {
    let synth;

    afterEach(() => {
        if (synth) {
            synth.dispose();
            synth = null;
        }
    });

    it('should produce a valid WAV buffer', () => {
        synth = new PiperSynthesizer(TEST_VOICE);
        const chunks = synth.synthesize('This is a test. This is another test.');
        const wav = chunksToWavBuffer(chunks);

        assert.ok(Buffer.isBuffer(wav));

        // Check RIFF header
        assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
        assert.equal(wav.toString('ascii', 12, 16), 'fmt ');

        // Check format
        assert.equal(wav.readUInt16LE(20), 1); // PCM
        assert.equal(wav.readUInt16LE(22), 1); // mono
        assert.equal(wav.readUInt32LE(24), 22050); // sample rate
        assert.equal(wav.readUInt16LE(34), 16); // bits per sample

        // Check data size: 2 sentences * 22050 samples * 2 bytes per sample
        assert.equal(wav.toString('ascii', 36, 40), 'data');
        assert.equal(wav.readUInt32LE(40), 22050 * 2 * 2);

        // Total file size: header (44) + data (22050 * 2 * 2)
        assert.equal(wav.length, 44 + 22050 * 2 * 2);
    });

    it('should throw for empty chunks', () => {
        assert.throws(() => chunksToWavBuffer([]), /No audio chunks/);
    });
});

describe('samplesToInt16', () => {
    it('should convert float samples to int16', () => {
        const float32 = new Float32Array([0, 1, -1, 0.5, -0.5]);
        const int16 = samplesToInt16(float32);

        assert.ok(int16 instanceof Int16Array);
        assert.equal(int16.length, 5);
        assert.equal(int16[0], 0);
        assert.equal(int16[1], 32767);
        assert.equal(int16[2], -32768);
    });

    it('should clamp values outside [-1, 1]', () => {
        const float32 = new Float32Array([2.0, -2.0]);
        const int16 = samplesToInt16(float32);

        assert.equal(int16[0], 32767);
        assert.equal(int16[1], -32768);
    });
});
