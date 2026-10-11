// Destinos dos frames: stdout (contrato §4.1), arquivos PCM (modo manual) e memória (testes).
#pragma once

#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "../common/chunker.hpp"

namespace rice {

/// Escrita assíncrona numa fila serial para não travar as threads de captura se o leitor do pipe ficar lento.
/// Acima de ~30 s de áudio pendente, descarta (e avisa uma vez).
class StdoutFrameSink : public FrameSink {
 public:
  static constexpr size_t kMaxPendingBytes = 30 * 16000 * 2;  // ~1,92 MB

  /// `out` precisa estar em modo binário (no Windows, _setmode antes).
  StdoutFrameSink(std::FILE* out, LineEmitter& events);
  ~StdoutFrameSink() override;

  void write(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples) override;
  /// Espera as escritas pendentes terminarem (antes de sair do processo).
  void drain();

 private:
  void run();

  std::FILE* out_;
  LineEmitter& events_;
  std::mutex mutex_;
  std::condition_variable wake_;
  std::condition_variable idle_;
  std::deque<std::vector<uint8_t>> queue_;
  size_t pendingBytes_ = 0;
  bool backpressured_ = false;
  bool writing_ = false;
  bool stop_ = false;
  bool broken_ = false;
  std::thread thread_;
};

/// Modo manual: PCM cru de cada fonte em DIR/mic.pcm e DIR/sys.pcm.
class FileFrameSink : public FrameSink {
 public:
  /// Cria o diretório e os arquivos; lança std::runtime_error se não conseguir.
  explicit FileFrameSink(const std::string& directory);
  ~FileFrameSink() override;
  void write(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples) override;

 private:
  std::mutex mutex_;
  std::FILE* mic_ = nullptr;
  std::FILE* sys_ = nullptr;
};

/// Guarda os frames em memória (testes).
class MemoryFrameSink : public FrameSink {
 public:
  struct Entry {
    Source source;
    uint64_t timestampMs;
    std::vector<int16_t> pcm;
  };
  void write(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples) override;
  std::vector<Entry> entries() const;

 private:
  mutable std::mutex mutex_;
  std::vector<Entry> entries_;
};

}  // namespace rice
