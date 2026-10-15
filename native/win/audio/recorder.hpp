// Orquestra mic + sistema + AEC + sleep guard (port do Recorder.swift). Toda a lógica aqui é portável;
// o hardware vem de um Platform.
#pragma once

#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "../common/chunker.hpp"
#include "../common/resampler.hpp"
#include "echo_canceller.hpp"
#include "platform.hpp"

namespace rice {

struct RecorderOptions {
  bool echoCancellation = true;
  std::string micDevice;  // id do endpoint escolhido; vazio = padrão do sistema
  std::vector<long> excludePids;
  std::chrono::milliseconds systemRetryDelay{1000};
};

class Recorder {
 public:
  Recorder(Platform& platform, FrameSink& sink, LineEmitter& events, RecorderOptions options);
  ~Recorder();

  /// Inicia (ignorado se já iniciou ou se stop já foi pedido). Emite `started`.
  void start();
  /// Para a gravação; também cancela um start em andamento. Emite `stopped` se havia gravação.
  void stop();

 private:
  uint64_t elapsedMs() const;
  bool stopRequested() const { return stopRequested_.load(); }
  bool startMic();
  bool startSystem();
  std::unique_ptr<CaptureHandle> openSystem(std::string& error);
  void configureEchoCancellation();
  void endDeviceWork();
  void handleSystemStopped(const std::string& message);
  void error(const char* source, const std::string& message, bool fatal);
  void onMicBlock(const float* data, size_t frames, int channels, int rate);
  void onSystemBlock(const float* data, size_t frames, int channels, int rate);

  Platform& platform_;
  FrameSink& sink_;
  LineEmitter& events_;
  RecorderOptions options_;
  std::unique_ptr<EchoCanceller> aec_;
  Chunker micChunker_;
  Chunker sysChunker_;
  Resampler micResampler_;
  Resampler sysResampler_;
  std::mutex micResamplerMutex_;
  std::mutex sysResamplerMutex_;

  std::mutex opMutex_;  // serializa start/stop/reinício
  std::mutex stateMutex_;
  std::chrono::steady_clock::time_point startTime_ = std::chrono::steady_clock::now();
  bool running_ = false;
  std::atomic<bool> stopRequested_{false};
  bool systemRestarted_ = false;
  bool sleepBlocked_ = false;
  std::function<void()> cancelOutputObserver_;
  std::unique_ptr<CaptureHandle> mic_;
  std::unique_ptr<CaptureHandle> system_;
  std::vector<std::thread> workers_;
};

}  // namespace rice
