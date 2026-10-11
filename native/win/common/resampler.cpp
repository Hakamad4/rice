#include "resampler.hpp"

#include <algorithm>
#include <cmath>

namespace rice {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr int kLobes = 12;  // lóbulos do sinc de cada lado, na taxa de saída
constexpr int kKernelRes = 512;  // pontos da tabela por amostra de entrada
}  // namespace

void Resampler::reset() {
  rate_ = 0;
  channels_ = 0;
  history_.clear();
  nextPos_ = 0;
}

void Resampler::configure(int sampleRate, int channels) {
  rate_ = sampleRate;
  channels_ = channels;
  step_ = static_cast<double>(sampleRate) / kOutputRate;
  // Corta um pouco abaixo do Nyquist de saída (8 kHz); ao subir de taxa, abaixo do Nyquist de entrada.
  cutoff_ = 0.5 * std::min(1.0, 1.0 / step_) * 0.92;
  halfWidth_ = static_cast<int>(std::ceil(kLobes * std::max(1.0, step_)));
  // Tabela do filtro: evita seno/cosseno por derivação (~16 mil saídas/s x dezenas de taps).
  const double width = static_cast<double>(halfWidth_);
  kernel_.assign(static_cast<size_t>(2 * halfWidth_ * kKernelRes + 2), 0.0f);
  for (size_t k = 0; k < kernel_.size(); k++) {
    const double d = static_cast<double>(k) / kKernelRes - width;
    const double x = 2.0 * cutoff_ * d;
    const double sinc = std::fabs(x) < 1e-12 ? 1.0 : std::sin(kPi * x) / (kPi * x);
    const double t = d / width;
    const double window = 0.42 + 0.5 * std::cos(kPi * t) + 0.08 * std::cos(2.0 * kPi * t);
    kernel_[k] = static_cast<float>(sinc * window);
  }
  history_.assign(static_cast<size_t>(halfWidth_), 0.0f);  // zeros antes do início: a saída começa sem atraso
  nextPos_ = halfWidth_;
}

std::vector<int16_t> Resampler::convert(const float* interleaved, size_t frames, int channels, int sampleRate) {
  std::vector<int16_t> out;
  if (frames == 0 || channels <= 0 || sampleRate <= 0) return out;
  if (sampleRate != rate_ || channels != channels_) configure(sampleRate, channels);

  // Mistura para mono (média dos canais).
  history_.reserve(history_.size() + frames);
  for (size_t i = 0; i < frames; i++) {
    float sum = 0;
    for (int c = 0; c < channels; c++) sum += interleaved[i * static_cast<size_t>(channels) + static_cast<size_t>(c)];
    history_.push_back(sum / static_cast<float>(channels));
  }

  const double width = static_cast<double>(halfWidth_);
  while (nextPos_ + width < static_cast<double>(history_.size())) {
    const double p = nextPos_;
    const long first = static_cast<long>(std::ceil(p - width));
    const long last = static_cast<long>(std::floor(p + width));
    double acc = 0, norm = 0;
    for (long i = first; i <= last; i++) {
      const double pos = (static_cast<double>(i) - p + width) * kKernelRes;
      const size_t k = static_cast<size_t>(pos);
      const double frac = pos - static_cast<double>(k);
      const double w = kernel_[k] + (kernel_[k + 1] - kernel_[k]) * frac;
      acc += w * (i >= 0 ? history_[static_cast<size_t>(i)] : 0.0f);
      norm += w;
    }
    const double v = norm != 0 ? acc / norm : 0.0;
    const double scaled = std::round(std::max(-1.0, std::min(1.0, v)) * 32767.0);
    out.push_back(static_cast<int16_t>(scaled));
    nextPos_ += step_;
  }

  // Descarta o que nenhuma saída futura vai usar.
  const long keepFrom = static_cast<long>(std::floor(nextPos_ - width)) - 1;
  if (keepFrom > 0 && static_cast<size_t>(keepFrom) < history_.size()) {
    history_.erase(history_.begin(), history_.begin() + keepFrom);
    nextPos_ -= static_cast<double>(keepFrom);
  }
  return out;
}

}  // namespace rice
