// WebRTC AEC3 sobre o microfone, com o áudio do sistema como referência (port do EchoCanceller.swift).
// Sem RICE_HAS_AEC no build, create() devolve nullptr e o resto do Recorder segue sem eco cancelado.
#pragma once

#include <memory>
#include <mutex>
#include <vector>

#include "../common/events.hpp"

struct rice_apm;

namespace rice {

class EchoCanceller {
 public:
  static constexpr size_t kFrameSamples = 160;  // 10 ms a 16 kHz

  /// nullptr se este build não inclui o WebRTC APM ou se a criação falhar.
  static std::unique_ptr<EchoCanceller> create(LineEmitter& events);
  static constexpr bool compiledIn() {
#ifdef RICE_HAS_AEC
    return true;
#else
    return false;
#endif
  }
  ~EchoCanceller();

  /// Desligado (ex.: saída em fone), o microfone passa sem alteração.
  void setEnabled(bool value);
  bool isEnabled();
  void pushRender(const std::vector<int16_t>& samples);
  /// Devolve o mic processado (múltiplo de 10 ms; o resto fica para a próxima chamada).
  std::vector<int16_t> processCapture(const std::vector<int16_t>& samples);
  /// O que sobrou (< 10 ms) no fim da gravação, sem processar.
  std::vector<int16_t> drainCapture();

 private:
  EchoCanceller(LineEmitter& events, rice_apm* handle) : events_(events), handle_(handle) {}
  void warnOnce(bool& flag, int code);

  LineEmitter& events_;
  rice_apm* handle_;
  std::mutex mutex_;
  std::vector<int16_t> renderPending_;
  std::vector<int16_t> capturePending_;
  bool enabled_ = true;
  bool renderWarned_ = false;
  bool captureWarned_ = false;
};

}  // namespace rice
