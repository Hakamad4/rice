// Frames do stdout do rice-audio: source(1) + timestampMs(u64 LE) + length(u32 LE) + PCM int16 LE.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace rice {

enum class Source : uint8_t { Mic = 0x01, Sys = 0x02 };

inline const char* sourceName(Source s) { return s == Source::Mic ? "mic" : "sys"; }

constexpr size_t kFrameHeaderBytes = 13;
constexpr size_t kMaxFramePayloadBytes = 1024 * 1024;
constexpr size_t kSamplesPerFrame = 1600;  // 100 ms a 16 kHz

/// Cabeçalho + payload (amostras serializadas em little-endian, em qualquer CPU).
std::vector<uint8_t> encodeFrame(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples);

struct DecodedFrame {
  Source source;
  uint64_t timestampMs;
  std::vector<int16_t> pcm;
};

/// Espelho do FrameDecoder do TS (src/shared/frames.ts): usado nos testes.
class FrameDecoder {
 public:
  /// Remonta frames de pedaços arbitrários. Em fonte inválida ou payload grande demais, marca `failed()` e para.
  std::vector<DecodedFrame> push(const uint8_t* data, size_t size);
  bool failed() const { return failed_; }
  size_t pendingBytes() const { return buffer_.size(); }

 private:
  std::vector<uint8_t> buffer_;
  bool failed_ = false;
};

}  // namespace rice
