// --selftest-tone / --selftest-gap / --selftest-aec (ports de SelfTest.swift).
#pragma once

#include <string>

#include "../common/chunker.hpp"

namespace rice {

/// 1 s de seno por fonte (mic 440 Hz, sys 880 Hz) entregue a 48 kHz estéreo, passando por Resampler + Chunker.
void runToneSelfTest(FrameSink& sink, LineEmitter& events);

/// 2 s de seno só no mic, com um buraco de 1 s no relógio entre os blocos 10 e 11. Esperado: ~3 s e um evento `gap`.
void runGapSelfTest(FrameSink& sink, LineEmitter& events);

/// Linha JSON com a redução de eco (ou `{"error":...}` se o build não tem AEC).
std::string runAecSelfTest(LineEmitter& events);

}  // namespace rice
