#include <napi.h>
#include <cstring>
#include <stdexcept>
#include <string>

#include "piper.h"

class PiperSynthesizerWrap : public Napi::ObjectWrap<PiperSynthesizerWrap> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    PiperSynthesizerWrap(const Napi::CallbackInfo &info);
    ~PiperSynthesizerWrap();

private:
    Napi::Value Synthesize(const Napi::CallbackInfo &info);
    Napi::Value GetDefaultOptions(const Napi::CallbackInfo &info);
    void Dispose(const Napi::CallbackInfo &info);

    piper_synthesizer *synth_ = nullptr;
};

Napi::Object PiperSynthesizerWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "PiperSynthesizer",
                                      {
                                          InstanceMethod<&PiperSynthesizerWrap::Synthesize>("synthesize"),
                                          InstanceMethod<&PiperSynthesizerWrap::GetDefaultOptions>("getDefaultOptions"),
                                          InstanceMethod<&PiperSynthesizerWrap::Dispose>("dispose"),
                                      });

    Napi::FunctionReference *ctor = new Napi::FunctionReference();
    *ctor = Napi::Persistent(func);
    exports.Set("PiperSynthesizer", func);
    env.SetInstanceData<Napi::FunctionReference>(ctor);

    return exports;
}

PiperSynthesizerWrap::PiperSynthesizerWrap(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<PiperSynthesizerWrap>(info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "modelPath (string) is required as the first argument")
            .ThrowAsJavaScriptException();
        return;
    }

    std::string model_path = info[0].As<Napi::String>().Utf8Value();

    const char *config_path = nullptr;
    std::string config_path_str;
    if (info.Length() > 1 && !info[1].IsNull() && !info[1].IsUndefined()) {
        if (!info[1].IsString()) {
            Napi::TypeError::New(env, "configPath must be a string or null")
                .ThrowAsJavaScriptException();
            return;
        }
        config_path_str = info[1].As<Napi::String>().Utf8Value();
        config_path = config_path_str.c_str();
    }

    const char *espeak_data_path = nullptr;
    std::string espeak_data_path_str;
    if (info.Length() > 2 && !info[2].IsNull() && !info[2].IsUndefined()) {
        if (!info[2].IsString()) {
            Napi::TypeError::New(env, "espeakDataPath must be a string or null")
                .ThrowAsJavaScriptException();
            return;
        }
        espeak_data_path_str = info[2].As<Napi::String>().Utf8Value();
        espeak_data_path = espeak_data_path_str.c_str();
    }

    try {
        synth_ = piper_create(model_path.c_str(), config_path, espeak_data_path);
    } catch (const std::exception &e) {
        std::string msg = "Failed to create Piper synthesizer: ";
        msg += e.what();
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return;
    }
    if (!synth_) {
        Napi::Error::New(env, "Failed to create Piper synthesizer. Check model and config paths.")
            .ThrowAsJavaScriptException();
        return;
    }
}

PiperSynthesizerWrap::~PiperSynthesizerWrap() {
    if (synth_) {
        piper_free(synth_);
        synth_ = nullptr;
    }
}

Napi::Value PiperSynthesizerWrap::Synthesize(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    if (!synth_) {
        Napi::Error::New(env, "Synthesizer has been disposed")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "text (string) is required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string text = info[0].As<Napi::String>().Utf8Value();

    // Parse synthesis options
    piper_synthesize_options options = piper_default_synthesize_options(synth_);
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object opts = info[1].As<Napi::Object>();

        if (opts.Has("speakerId") && opts.Get("speakerId").IsNumber()) {
            options.speaker_id = opts.Get("speakerId").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("lengthScale") && opts.Get("lengthScale").IsNumber()) {
            options.length_scale = opts.Get("lengthScale").As<Napi::Number>().FloatValue();
        }
        if (opts.Has("noiseScale") && opts.Get("noiseScale").IsNumber()) {
            options.noise_scale = opts.Get("noiseScale").As<Napi::Number>().FloatValue();
        }
        if (opts.Has("noiseWScale") && opts.Get("noiseWScale").IsNumber()) {
            options.noise_w_scale = opts.Get("noiseWScale").As<Napi::Number>().FloatValue();
        }
    }

    // Start synthesis
    int result;
    try {
        result = piper_synthesize_start(synth_, text.c_str(), &options);
    } catch (const std::exception &e) {
        std::string msg = "Failed to start synthesis: ";
        msg += e.what();
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (result != PIPER_OK) {
        Napi::Error::New(env, "Failed to start synthesis")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Collect all audio chunks
    Napi::Array chunks = Napi::Array::New(env);
    uint32_t chunk_idx = 0;

    piper_audio_chunk chunk;
    while (true) {
        try {
            result = piper_synthesize_next(synth_, &chunk);
        } catch (const std::exception &e) {
            std::string msg = "Synthesis failed: ";
            msg += e.what();
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (result == PIPER_DONE) {
            break;
        }
        if (result != PIPER_OK) {
            Napi::Error::New(env, "Synthesis failed during audio generation")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        Napi::Object chunk_obj = Napi::Object::New(env);

        // Audio samples as Float32Array
        Napi::Float32Array samples = Napi::Float32Array::New(env, chunk.num_samples);
        if (chunk.num_samples > 0 && chunk.samples) {
            std::memcpy(samples.Data(), chunk.samples,
                        chunk.num_samples * sizeof(float));
        }
        chunk_obj.Set("samples", samples);

        chunk_obj.Set("sampleRate", Napi::Number::New(env, chunk.sample_rate));
        chunk_obj.Set("isLast", Napi::Boolean::New(env, chunk.is_last));

        // Phoneme codepoints as Uint32Array
        if (chunk.phonemes && chunk.num_phonemes > 0) {
            Napi::Uint32Array phonemes_arr =
                Napi::Uint32Array::New(env, chunk.num_phonemes);
            for (size_t i = 0; i < chunk.num_phonemes; i++) {
                phonemes_arr[i] = static_cast<uint32_t>(chunk.phonemes[i]);
            }
            chunk_obj.Set("phonemes", phonemes_arr);
        } else {
            chunk_obj.Set("phonemes", env.Null());
        }

        // Phoneme IDs as Int32Array
        if (chunk.phoneme_ids && chunk.num_phoneme_ids > 0) {
            Napi::Int32Array phoneme_ids_arr =
                Napi::Int32Array::New(env, chunk.num_phoneme_ids);
            std::memcpy(phoneme_ids_arr.Data(), chunk.phoneme_ids,
                        chunk.num_phoneme_ids * sizeof(int));
            chunk_obj.Set("phonemeIds", phoneme_ids_arr);
        } else {
            chunk_obj.Set("phonemeIds", env.Null());
        }

        // Alignments as Int32Array
        if (chunk.alignments && chunk.num_alignments > 0) {
            Napi::Int32Array alignments_arr =
                Napi::Int32Array::New(env, chunk.num_alignments);
            std::memcpy(alignments_arr.Data(), chunk.alignments,
                        chunk.num_alignments * sizeof(int));
            chunk_obj.Set("alignments", alignments_arr);
        } else {
            chunk_obj.Set("alignments", env.Null());
        }

        chunks.Set(chunk_idx++, chunk_obj);
    }

    return chunks;
}

Napi::Value PiperSynthesizerWrap::GetDefaultOptions(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    if (!synth_) {
        Napi::Error::New(env, "Synthesizer has been disposed")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    piper_synthesize_options options = piper_default_synthesize_options(synth_);

    Napi::Object result = Napi::Object::New(env);
    result.Set("speakerId", Napi::Number::New(env, options.speaker_id));
    result.Set("lengthScale", Napi::Number::New(env, options.length_scale));
    result.Set("noiseScale", Napi::Number::New(env, options.noise_scale));
    result.Set("noiseWScale", Napi::Number::New(env, options.noise_w_scale));

    return result;
}

void PiperSynthesizerWrap::Dispose(const Napi::CallbackInfo &info) {
    if (synth_) {
        piper_free(synth_);
        synth_ = nullptr;
    }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return PiperSynthesizerWrap::Init(env, exports);
}

NODE_API_MODULE(piper_node, Init)
