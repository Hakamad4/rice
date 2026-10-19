#include "ct2_model.hpp"

#include <ctranslate2/translator.h>
#include <sentencepiece_processor.h>

#include <stdexcept>

namespace rice::translate {

namespace {
bool exists(const std::string& path) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  std::fclose(f);
  return true;
}

const std::string kSpace = "\xE2\x96\x81";  // U+2581, o marcador de início de palavra do sentencepiece

std::string joinPieces(const std::vector<std::string>& pieces) {
  std::string joined;
  for (const auto& p : pieces) joined += p;
  std::string out;
  for (size_t i = 0; i < joined.size();) {
    if (joined.compare(i, kSpace.size(), kSpace) == 0) {
      out += ' ';
      i += kSpace.size();
    } else {
      out += joined[i++];
    }
  }
  const auto b = out.find_first_not_of(' ');
  const auto e = out.find_last_not_of(' ');
  return b == std::string::npos ? std::string() : out.substr(b, e - b + 1);
}

class Ct2Model : public Model {
 public:
  Ct2Model(const std::string& dir, size_t threads, size_t beam) : beam_(beam) {
    const std::string sep = "/";
    // Pacotes com um só sentencepiece (sentencepiece.model) usam o mesmo para origem e destino.
    const std::string shared = dir + sep + "sentencepiece.model";
    const std::string src = exists(dir + sep + "source.spm") ? dir + sep + "source.spm" : shared;
    const std::string tgt = exists(dir + sep + "target.spm") ? dir + sep + "target.spm" : src;
    if (!exists(dir + sep + "model.bin") || !exists(src)) throw std::runtime_error("incomplete model folder: " + dir);
    if (!source_.Load(src).ok() || !target_.Load(tgt).ok()) throw std::runtime_error("invalid sentencepiece model in " + dir);
    ctranslate2::ReplicaPoolConfig config;
    config.num_threads_per_replica = threads;
    translator_ = std::make_unique<ctranslate2::Translator>(dir, ctranslate2::Device::CPU, ctranslate2::ComputeType::INT8,
                                                            std::vector<int>{0}, false, config);
  }

  std::vector<std::string> translate(const std::vector<std::string>& sentences, const std::string& prefix) override {
    std::vector<std::vector<std::string>> batch;
    for (const auto& s : sentences) {
      std::vector<std::string> pieces;
      if (!prefix.empty()) pieces.push_back(prefix);
      std::vector<std::string> enc;
      source_.Encode(s, &enc);
      pieces.insert(pieces.end(), enc.begin(), enc.end());
      pieces.push_back("</s>");
      batch.push_back(std::move(pieces));
    }
    ctranslate2::TranslationOptions options;
    options.beam_size = beam_;
    options.max_decoding_length = 256;
    options.max_input_length = 512;
    const auto results = translator_->translate_batch(batch, options, /*max_batch_size=*/1);
    std::vector<std::string> out;
    for (const auto& r : results) {
      std::string text;
      if (!r.hypotheses.empty()) {
        target_.Decode(r.hypotheses[0], &text);
        // Pacotes cujo vocabulário não coincide com o do .spm (ex.: os do Argos) deixam "▁" no texto: junta as peças à mão.
        if (text.find(kSpace) != std::string::npos) text = joinPieces(r.hypotheses[0]);
      }
      out.push_back(std::move(text));
    }
    return out;
  }

 private:
  size_t beam_;
  sentencepiece::SentencePieceProcessor source_, target_;
  std::unique_ptr<ctranslate2::Translator> translator_;
};
}  // namespace

std::unique_ptr<Model> loadCt2Model(const std::string& dir, size_t threads, size_t beam) { return std::make_unique<Ct2Model>(dir, threads, beam); }

const char* ct2BackendName() {
#if defined(CT2_WITH_ACCELERATE)
  return "ct2-accelerate-ruy";
#else
  return "ct2-ruy";
#endif
}

}  // namespace rice::translate
