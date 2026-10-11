// Fronteira entre a lógica portável do Recorder e o que depende do sistema (WASAPI, energia, dispositivos).
// Windows: audio/win/*. Qualquer sistema: SimulatedPlatform (tons sintéticos) para testes e CI.
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace rice {

/// Bloco de áudio como o sistema entrega: float intercalado, taxa e canais nativos.
using BlockCallback = std::function<void(const float* interleaved, size_t frames, int channels, int sampleRate)>;

class CaptureHandle {
 public:
  virtual ~CaptureHandle() = default;
  virtual void stop() = 0;
};

struct OutputInfo {
  std::string name;
  bool isHeadphones = false;
  std::string reason;
};

enum class CaptureFailure { None, PermissionDenied, Other };

class Platform {
 public:
  virtual ~Platform() = default;

  /// Abre o microfone padrão. `onDeviceChanged` é chamado depois de reabrir por troca de dispositivo;
  /// `onFatal` quando a reabertura falha de vez. Em falha devolve nullptr e preenche `error`/`failure`.
  virtual std::unique_ptr<CaptureHandle> startMic(BlockCallback onBlock, std::function<void()> onDeviceChanged, std::function<void(std::string)> onFatal, std::string& error, CaptureFailure& failure) = 0;

  /// Abre a captura do áudio do sistema. `onStopped` quando ela para sozinha (o Recorder reinicia uma vez).
  virtual std::unique_ptr<CaptureHandle> startSystem(BlockCallback onBlock, std::function<void(std::string)> onStopped, const std::vector<long>& excludePids, std::string& error) = 0;

  virtual OutputInfo currentOutput() = 0;
  /// Chama `handler` quando a saída padrão muda (de qualquer thread). Devolve quem cancela.
  virtual std::function<void()> observeOutput(std::function<void()> handler) = 0;

  /// Impede a suspensão por inatividade enquanto grava. Devolve false (e `warning`) se não conseguiu.
  virtual bool preventSleep(std::string& warning) = 0;
  virtual void allowSleep() = 0;
};

}  // namespace rice
