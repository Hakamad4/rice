// Plataforma sem hardware: tons sintéticos (mic 440 Hz, sys 880 Hz, 48 kHz estéreo, blocos de 10 ms em tempo real).
// Usada por --simulate-capture, pelo smoke test do CI e pelos testes do Recorder.
#pragma once

#include <atomic>
#include <mutex>

#include "platform.hpp"

namespace rice {

class SimulatedPlatform : public Platform {
 public:
  struct Script {
    bool micPermissionDenied = false;
    bool systemFails = false;
    bool headphones = false;
    bool realTime = true;  // false: gera os blocos o mais rápido possível (testes)
    int micBlocks = -1;    // quantos blocos gerar antes de parar sozinho (-1: sem fim)
    int systemStopsAfterBlocks = -1;  // a captura do sistema "para sozinha" depois desses blocos (-1: nunca)
  };

  SimulatedPlatform() = default;
  explicit SimulatedPlatform(Script script) : script_(script) {}

  std::unique_ptr<CaptureHandle> startMic(BlockCallback onBlock, std::function<void()> onDeviceChanged, std::function<void(std::string)> onFatal, std::string& error, CaptureFailure& failure) override;
  std::unique_ptr<CaptureHandle> startSystem(BlockCallback onBlock, std::function<void(std::string)> onStopped, const std::vector<long>& excludePids, std::string& error) override;
  OutputInfo currentOutput() override;
  std::function<void()> observeOutput(std::function<void()> handler) override;
  bool preventSleep(std::string& warning) override;
  void allowSleep() override;

  /// Simula troca da saída padrão (dispara os observadores) para fone/alto-falante.
  void setHeadphones(bool value);
  int sleepBlocks() const { return sleepBlocks_.load(); }
  int sleepReleases() const { return sleepReleases_.load(); }
  int systemOpens() const { return systemOpens_.load(); }

 private:
  Script script_;
  std::mutex mutex_;
  std::vector<std::function<void()>> observers_;
  std::atomic<int> sleepBlocks_{0};
  std::atomic<int> sleepReleases_{0};
  std::atomic<int> systemOpens_{0};
  std::atomic<bool> headphones_{false};
};

}  // namespace rice
