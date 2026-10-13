// Converte PCM float intercalado de qualquer taxa/canais para 16 kHz mono int16, mantendo o estado do filtro
// entre chamadas (polifásico com janela Blackman). Substitui o AVAudioConverter do Swift.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace rice {

class Resampler {
 public:
  static constexpr int kOutputRate = 16000;

  /// `interleaved` tem frames*channels floats em [-1, 1]. Devolve as amostras prontas (o filtro guarda
  /// alguns milissegundos de atraso até chegar o futuro de que precisa). Formato novo recria o estado.
  std::vector<int16_t> convert(const float* interleaved, size_t frames, int channels, int sampleRate);

  /// Zera o estado (próxima conversão começa limpa).
  void reset();

 private:
  void configure(int sampleRate, int channels);

  int rate_ = 0;
  int channels_ = 0;
  double step_ = 1.0;             // amostras de entrada por amostra de saída
  double cutoff_ = 0.45;          // ciclos por amostra de entrada
  int halfWidth_ = 0;             // metade da janela, em amostras de entrada
  std::vector<float> kernel_;     // sinc com janela, amostrado em 1/kKernelRes de amostra de entrada
  std::vector<float> history_;    // mono já misturado; history_[0] corresponde à posição absoluta base_
  double nextPos_ = 0;            // posição (em amostras de entrada, relativa a history_[0]) da próxima saída
};

}  // namespace rice
