#include "selftests.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <random>

#include "../common/resampler.hpp"
#include "echo_canceller.hpp"

namespace rice {

namespace {
constexpr double kPi = 3.14159265358979323846;
}

void runToneSelfTest(FrameSink& sink, LineEmitter& events) {
  const int block = 4800;
  struct Tone { Source source; double frequency; };
  for (Tone tone : {Tone{Source::Mic, 440.0}, Tone{Source::Sys, 880.0}}) {
    Resampler resampler;
    Chunker chunker(tone.source, sink, events);
    std::vector<float> stereo(static_cast<size_t>(block) * 2);
    for (int index = 0; index < 10; index++) {
      for (int i = 0; i < block; i++) {
        double t = static_cast<double>(index * block + i) / 48000.0;
        float v = static_cast<float>(0.5 * std::sin(2 * kPi * tone.frequency * t));
        stereo[static_cast<size_t>(i) * 2] = v;
        stereo[static_cast<size_t>(i) * 2 + 1] = v;
      }
      chunker.append(resampler.convert(stereo.data(), block, 2, 48000), 0);
    }
    chunker.flush();
  }
}

void runGapSelfTest(FrameSink& sink, LineEmitter& events) {
  Chunker chunker(Source::Mic, sink, events);
  const int block = 1600;
  for (int index = 0; index < 20; index++) {
    std::vector<int16_t> samples(static_cast<size_t>(block));
    for (int i = 0; i < block; i++) {
      double t = static_cast<double>(index * block + i) / 16000.0;
      samples[static_cast<size_t>(i)] = static_cast<int16_t>(0.5 * 32767 * std::sin(2 * kPi * 440 * t));
    }
    uint64_t nowMs = static_cast<uint64_t>(index + 1) * 100 + (index >= 10 ? 1000 : 0);
    chunker.append(samples, nowMs);
  }
  chunker.flush();
}

namespace {
double energyDb(const std::vector<int16_t>& s, size_t from, size_t to) {
  double sum = 0;
  for (size_t i = from; i < to; i++) sum += static_cast<double>(s[i]) * s[i];
  return 10 * std::log10(sum / static_cast<double>(to - from) + 1e-9);
}
int16_t clamp16(double v) { return static_cast<int16_t>(std::max(-32767.0, std::min(32767.0, v))); }
}  // namespace

std::string runAecSelfTest(LineEmitter& events) {
  auto aec = EchoCanceller::create(events);
  if (!aec) {
    return EchoCanceller::compiledIn() ? R"({"error":"falha ao criar o AEC"})" : R"({"error":"AEC3 não incluído neste build"})";
  }
  const size_t rate = 16000, total = rate * 6;
  std::mt19937_64 gen{std::random_device{}()};
  std::uniform_real_distribution<double> uni(-1, 1);
  std::vector<int16_t> reference(total), mic(total), voice(total, 0);
  double lowpass = 0;
  for (size_t i = 0; i < total; i++) {
    double t = static_cast<double>(i) / rate;
    double envelope = 0.5 + 0.5 * std::sin(2 * kPi * 3 * t);
    lowpass += 0.3 * (uni(gen) - lowpass);
    double tone = 0.3 * std::sin(2 * kPi * 220 * t) + 0.2 * std::sin(2 * kPi * 660 * t);
    reference[i] = clamp16(12000 * envelope * (lowpass + tone));
  }
  for (size_t i = 0; i < total; i++) {
    double v = 0;
    if (i >= 640) v += 0.5 * reference[i - 640];
    if (i >= 960) v += 0.2 * reference[i - 960];
    mic[i] = clamp16(v);
  }
  const size_t voiceStart = rate * 7 / 2, voiceEnd = rate * 9 / 2;
  for (size_t i = voiceStart; i < voiceEnd; i++) {
    double t = static_cast<double>(i) / rate;
    double envelope = 0.6 + 0.4 * std::sin(2 * kPi * 4 * t);
    voice[i] = static_cast<int16_t>(6000 * envelope * (std::sin(2 * kPi * 300 * t) + 0.5 * std::sin(2 * kPi * 900 * t)));
    mic[i] = clamp16(static_cast<double>(mic[i]) + voice[i]);
  }
  std::vector<int16_t> output;
  const size_t frame = EchoCanceller::kFrameSamples;
  for (size_t start = 0; start < total; start += frame) {
    aec->pushRender(std::vector<int16_t>(reference.begin() + static_cast<std::ptrdiff_t>(start), reference.begin() + static_cast<std::ptrdiff_t>(start + frame)));
    auto cleaned = aec->processCapture(std::vector<int16_t>(mic.begin() + static_cast<std::ptrdiff_t>(start), mic.begin() + static_cast<std::ptrdiff_t>(start + frame)));
    output.insert(output.end(), cleaned.begin(), cleaned.end());
  }
  const size_t tail = total - rate;
  double inDb = energyDb(mic, tail, total);
  double outDb = energyDb(output, tail, std::min(total, output.size()));
  size_t vFrom = voiceStart + rate / 10;
  double voiceLossDb = energyDb(voice, vFrom, voiceEnd) - energyDb(output, vFrom, voiceEnd);
  char buf[160];
  std::snprintf(buf, sizeof buf, "{\"inDb\":%.1f,\"outDb\":%.1f,\"reductionDb\":%.1f,\"voiceLossDb\":%.1f}", inDb, outDb, inDb - outDb, voiceLossDb);
  return buf;
}

}  // namespace rice
