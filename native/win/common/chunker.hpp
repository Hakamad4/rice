// Junta amostras de 16 kHz em frames de 100 ms. Port 1:1 do Chunker.swift: timestamp contado por amostras,
// silêncio inserido se o relógio real adiantar mais de 200 ms.
#pragma once

#include <cstdint>
#include <mutex>
#include <vector>

#include "events.hpp"
#include "framing.hpp"

namespace rice {

class FrameSink {
 public:
  virtual ~FrameSink() = default;
  virtual void write(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples) = 0;
};

class Chunker {
 public:
  static constexpr uint64_t kGapThresholdMs = 200;

  Chunker(Source source, FrameSink& sink, LineEmitter& events) : source_(source), sink_(sink), events_(events) {}

  /// `nowMs`: instante (ms desde o início da gravação) em que `samples` chegou, isto é, o fim real dessas amostras.
  void append(const std::vector<int16_t>& samples, uint64_t nowMs);
  /// Escreve o que sobrou como um último frame parcial.
  void flush();

 private:
  struct Frame {
    uint64_t timestampMs;
    std::vector<int16_t> pcm;
  };
  std::vector<Frame> drainFrames();                       // com o lock tomado
  Frame makeFrame(const int16_t* samples, size_t count);  // com o lock tomado
  void write(const std::vector<Frame>& frames);

  Source source_;
  FrameSink& sink_;
  LineEmitter& events_;
  std::mutex mutex_;
  std::vector<int16_t> pending_;
  bool hasStart_ = false;
  uint64_t startOffsetMs_ = 0;
  uint64_t emittedSamples_ = 0;
};

}  // namespace rice
