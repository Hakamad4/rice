// Paridade com o Swift: tudo aqui compara com fixtures gravados do rice-audio/rice-detector de macOS.
#include <algorithm>
#include <cmath>
#include <map>
#include <thread>

#include "../audio/output_classify.hpp"
#include "../audio/recorder.hpp"
#include "../audio/selftests.hpp"
#include "../audio/simulated_platform.hpp"
#include "../audio/sinks.hpp"
#include "../common/framing.hpp"
#include "../common/json.hpp"
#include "../detector/app_matcher.hpp"
#include "../detector/mic_monitor.hpp"
#include "../detector/mic_watcher.hpp"
#include "check.hpp"
#include "fixtures.hpp"

using namespace rice;

namespace {

struct Capture {
  std::vector<std::string> lines;
  LineEmitter emitter{[this](const std::string& l) { lines.push_back(l); }};
};

std::vector<DecodedFrame> decode(const std::vector<uint8_t>& bytes) {
  FrameDecoder d;
  auto frames = d.push(bytes.data(), bytes.size());
  CHECK(!d.failed());
  CHECK_EQ(d.pendingBytes(), static_cast<size_t>(0));
  return frames;
}

std::vector<DecodedFrame> ofSource(const std::vector<DecodedFrame>& all, Source s) {
  std::vector<DecodedFrame> out;
  for (const auto& f : all) {
    if (f.source == s) out.push_back(f);
  }
  return out;
}

std::vector<int16_t> samplesOf(const std::vector<DecodedFrame>& frames) {
  std::vector<int16_t> out;
  for (const auto& f : frames) out.insert(out.end(), f.pcm.begin(), f.pcm.end());
  return out;
}

double rms(const std::vector<int16_t>& s, size_t from = 0, size_t to = SIZE_MAX) {
  to = std::min(to, s.size());
  double sum = 0;
  for (size_t i = from; i < to; i++) sum += static_cast<double>(s[i]) * s[i];
  return std::sqrt(sum / static_cast<double>(to - from));
}

std::vector<uint8_t> toBytes(const MemoryFrameSink& sink) {
  std::vector<uint8_t> out;
  for (const auto& e : sink.entries()) {
    auto f = encodeFrame(e.source, e.timestampMs, e.pcm.data(), e.pcm.size());
    out.insert(out.end(), f.begin(), f.end());
  }
  return out;
}

}  // namespace

TEST(json_serializa_como_o_foundation_com_sortedKeys) {
  json::Value v = json::Value::object();
  v.set("source", "mic").set("ms", 1000).set("a/b", "x\"y\\z\n");
  CHECK_EQ(v.dump(), std::string(R"({"a\/b":"x\"y\\z\n","ms":1000,"source":"mic"})"));
  json::Value n = json::Value::object();
  n.set("app", nullptr).set("ok", true).set("list", json::Value::array().push(1).push("a"));
  CHECK_EQ(n.dump(), std::string(R"({"app":null,"list":[1,"a"],"ok":true})"));
}

TEST(json_le_comandos_e_rejeita_lixo) {
  auto c = json::parseCommand(R"({"cmd":"complete-reminder","id":"aç😀"})");
  CHECK(c.has_value());
  CHECK_EQ(c->name, std::string("complete-reminder"));
  CHECK_EQ(c->body.getString("id"), std::string("a\xc3\xa7\xf0\x9f\x98\x80"));
  CHECK(!json::parseCommand("lixo").has_value());
  CHECK(!json::parseCommand("[1]").has_value());
  CHECK(!json::parseCommand(R"({"cmd":1})").has_value());
  CHECK(!json::parseCommand(R"({"cmd":"x"} x)").has_value());
  CHECK(json::parseCommand(R"({"cmd":"list-events","from":"2026-10-11T10:00:00.000Z"})").has_value());
}

TEST(framing_ida_e_volta_com_pedacos_arbitrarios) {
  int16_t pcm[4] = {1, -2, 300, -32768};
  auto bytes = encodeFrame(Source::Sys, 0x0102030405ULL, pcm, 4);
  CHECK_EQ(bytes.size(), kFrameHeaderBytes + 8);
  CHECK_EQ(bytes[0], static_cast<uint8_t>(2));
  CHECK_EQ(bytes[1], static_cast<uint8_t>(0x05));
  CHECK_EQ(bytes[9], static_cast<uint8_t>(8));
  FrameDecoder d;
  std::vector<DecodedFrame> all;
  for (size_t i = 0; i < bytes.size(); i++) {
    auto part = d.push(&bytes[i], 1);
    all.insert(all.end(), part.begin(), part.end());
  }
  CHECK_EQ(all.size(), static_cast<size_t>(1));
  CHECK_EQ(all[0].timestampMs, static_cast<uint64_t>(0x0102030405ULL));
  CHECK_EQ(all[0].pcm[3], static_cast<int16_t>(-32768));
  uint8_t bad[13] = {7};
  FrameDecoder d2;
  d2.push(bad, 13);
  CHECK(d2.failed());
}

TEST(selftest_gap_e_identico_bit_a_bit_ao_do_swift) {
  Capture cap;
  MemoryFrameSink sink;
  runGapSelfTest(sink, cap.emitter);
  CHECK(toBytes(sink) == readFixture("protocol/gap.bin"));
  CHECK_EQ(cap.lines.size(), static_cast<size_t>(1));
  std::string expected = readFixtureText("protocol/gap.stderr");
  while (!expected.empty() && (expected.back() == '\n' || expected.back() == '\r')) expected.pop_back();
  CHECK_EQ(cap.lines.empty() ? std::string() : cap.lines[0], expected);
}

TEST(selftest_tone_tem_a_mesma_estrutura_e_sinal_do_swift) {
  Capture cap;
  MemoryFrameSink sink;
  runToneSelfTest(sink, cap.emitter);
  CHECK(cap.lines.empty());
  auto mine = decode(toBytes(sink));
  auto swift = decode(readFixture("protocol/tone.bin"));
  for (Source s : {Source::Mic, Source::Sys}) {
    auto a = ofSource(mine, s), b = ofSource(swift, s);
    CHECK(a.size() >= 9 && a.size() <= 10);
    CHECK_EQ(a.size(), b.size());
    for (size_t i = 0; i < a.size(); i++) {
      CHECK_EQ(a[i].timestampMs, static_cast<uint64_t>(i * 100));  // 100 ms por frame
      if (i + 1 < a.size()) CHECK_EQ(a[i].pcm.size(), static_cast<size_t>(1600));
    }
    // Os dois resamplers devem produzir o mesmo sinal: compara amostra a amostra, ignorando o início (aquecimento do filtro)
    // e o final (o Swift perde ~260 amostras, o nosso não).
    auto x = samplesOf(a), y = samplesOf(b);
    size_t n = std::min(x.size(), y.size()) - 200;
    int maxDiff = 0;
    for (size_t i = 100; i < n; i++) maxDiff = std::max(maxDiff, std::abs(x[i] - y[i]));
    std::fprintf(stderr, "  %s: maxDiff=%d rms=%.0f (swift %.0f)\n", sourceName(s), maxDiff, rms(x), rms(y));
    CHECK(maxDiff < 330);  // 1% do fundo de escala
    CHECK(std::fabs(rms(x) - 11585) < 400);
    CHECK(*std::max_element(x.begin(), x.end()) < 32767);
  }
}

TEST(resampler_mantem_estado_entre_blocos_e_aceita_outras_taxas) {
  // 44,1 kHz mono, 1 s em blocos irregulares: ~16000 saídas e a mesma frequência.
  Resampler r;
  std::vector<int16_t> out;
  size_t pos = 0;
  const size_t total = 44100;
  const size_t sizes[] = {441, 1000, 333, 4096};
  for (size_t k = 0; pos < total; k++) {
    size_t n = std::min(sizes[k % 4], total - pos);
    std::vector<float> block(n);
    for (size_t i = 0; i < n; i++) block[i] = static_cast<float>(0.5 * std::sin(2 * 3.14159265358979 * 1000 * static_cast<double>(pos + i) / 44100));
    auto part = r.convert(block.data(), n, 1, 44100);
    out.insert(out.end(), part.begin(), part.end());
    pos += n;
  }
  CHECK(out.size() > 15900 && out.size() <= 16000);
  int crossings = 0;
  for (size_t i = 101; i < out.size(); i++) crossings += (out[i - 1] < 0) != (out[i] < 0);
  double hz = crossings / 2.0 / (static_cast<double>(out.size() - 100) / 16000);
  CHECK(std::fabs(hz - 1000) < 15);
  // Mudar o formato no meio recria o estado sem travar.
  float stereo[960] = {};
  CHECK(r.convert(stereo, 480, 2, 48000).size() <= 160);
}

TEST(chunker_insere_silencio_so_acima_de_200ms) {
  Capture cap;
  MemoryFrameSink sink;
  Chunker c(Source::Mic, sink, cap.emitter);
  std::vector<int16_t> block(1600, 7);
  c.append(block, 100);
  c.append(block, 300);  // 100 ms de atraso: dentro da tolerância
  CHECK(cap.lines.empty());
  c.append(block, 900);  // 600 ms além do esperado
  CHECK_EQ(cap.lines.size(), static_cast<size_t>(1));
  CHECK_EQ(cap.lines[0], std::string(R"({"event":"gap","ms":600,"source":"mic"})"));
  c.flush();
  size_t total = 0;
  for (auto& e : sink.entries()) total += e.pcm.size();
  CHECK_EQ(total, static_cast<size_t>(1600 * 3 + 600 * 16));
}

TEST(app_matcher_segue_a_tabela_do_swift) {
  auto doc = json::parse(readFixtureText("protocol/detector.json"));
  CHECK(doc.has_value());
  for (const auto& item : doc->get("match")->items()) {
    auto app = matchApp(item.get("input")->str());
    const json::Value* expected = item.get("output")->get("app");
    if (expected->isNull()) CHECK(!app.has_value());
    else CHECK_EQ(app.value_or("(nenhum)"), expected->str());
  }
}

TEST(mic_watcher_gera_os_mesmos_eventos_do_swift) {
  auto doc = json::parse(readFixtureText("protocol/detector.json"));
  for (const auto& item : doc->get("simulateMic")->items()) {
    Capture cap;
    MicWatcher watcher(cap.emitter);
    for (const auto& step : item.get("input")->items()) {
      std::vector<std::string> ids;
      for (const auto& id : step.items()) ids.push_back(id.str());
      watcher.tick(ids);
    }
    const auto& expected = item.get("output")->items();
    CHECK_EQ(cap.lines.size(), expected.size());
    for (size_t i = 0; i < expected.size() && i < cap.lines.size(); i++) CHECK_EQ(cap.lines[i], expected[i].dump());
  }
}

TEST(app_matcher_windows_e_chaves_do_registro) {
  CHECK_EQ(matchApp("Zoom.exe").value_or(""), std::string("Zoom"));
  CHECK_EQ(matchApp("ms-teams.exe").value_or(""), std::string("Microsoft Teams"));
  CHECK_EQ(matchApp("MSTeams_8wekyb3d8bbwe").value_or(""), std::string("Microsoft Teams"));
  CHECK_EQ(matchApp("chrome.exe").value_or(""), std::string("Google Chrome"));
  CHECK_EQ(matchApp("MSEDGE.EXE").value_or(""), std::string("Microsoft Edge"));
  CHECK(!matchApp("RiceApp.exe").has_value());
  CHECK(!matchApp("notchrome.exe").has_value());
  CHECK_EQ(executableFromConsentKey("C:#Program Files#Google#Chrome#Application#chrome.exe"), std::string("chrome.exe"));
  CHECK_EQ(executableFromConsentKey("MSTeams_8wekyb3d8bbwe"), std::string("MSTeams_8wekyb3d8bbwe"));
}

TEST(classificacao_da_saida_fone_ou_alto_falante) {
  CHECK(classifyOutput("Alto-falantes (Realtek)", 1, false).isHeadphones == false);
  CHECK(classifyOutput("Alto-falantes (Realtek)", 3, false).isHeadphones);
  CHECK(classifyOutput("Qualquer", 1, true).isHeadphones);
  CHECK(classifyOutput("AirPods de Ana", 1, false).isHeadphones);
  CHECK(classifyOutput("Headset (Jabra)", 10, false).isHeadphones);
  CHECK_EQ(classifyOutput("", 1, false).name, std::string("?"));
}

TEST(recorder_simulado_grava_as_duas_fontes_e_emite_os_eventos) {
  Capture cap;
  MemoryFrameSink sink;
  SimulatedPlatform platform;
  RecorderOptions opt;
  opt.echoCancellation = false;
  {
    Recorder rec(platform, sink, cap.emitter, opt);
    rec.start();
    std::this_thread::sleep_for(std::chrono::milliseconds(1200));
    rec.stop();
    rec.stop();  // idempotente
  }
  std::string all;
  for (auto& l : cap.lines) all += l + "\n";
  CHECK(all.find(R"({"enabled":false,"event":"aec","reason":"desligado por --no-aec"})") != std::string::npos);
  CHECK(all.find(R"({"event":"started","mic":true,"sys":true})") != std::string::npos);
  CHECK(all.find(R"({"event":"stopped"})") != std::string::npos);
  CHECK_EQ(platform.sleepBlocks(), 1);
  CHECK_EQ(platform.sleepReleases(), 1);
  auto frames = decode(toBytes(sink));
  for (Source s : {Source::Mic, Source::Sys}) {
    auto f = ofSource(frames, s);
    CHECK(f.size() >= 9 && f.size() <= 13);
    for (size_t i = 1; i < f.size(); i++) CHECK_EQ(f[i].timestampMs - f[i - 1].timestampMs, static_cast<uint64_t>(100));
  }
}

TEST(recorder_start_depois_de_stop_e_ignorado_e_permissao_negada_vira_erro) {
  {
    Capture cap;
    MemoryFrameSink sink;
    SimulatedPlatform platform;
    Recorder rec(platform, sink, cap.emitter, {});
    rec.stop();
    rec.start();
    CHECK(cap.lines.empty());
  }
  Capture cap;
  MemoryFrameSink sink;
  SimulatedPlatform::Script script;
  script.micPermissionDenied = true;
  SimulatedPlatform platform(script);
  RecorderOptions opt;
  opt.echoCancellation = false;
  Recorder rec(platform, sink, cap.emitter, opt);
  rec.start();
  rec.stop();
  std::string all;
  for (auto& l : cap.lines) all += l + "\n";
  CHECK(all.find(R"({"event":"error","message":"permissão de microfone negada","source":"mic"})") != std::string::npos);
  CHECK(all.find(R"({"event":"started","mic":false,"sys":true})") != std::string::npos);
}

TEST(recorder_reinicia_o_sistema_uma_vez_e_depois_fica_fatal) {
  Capture cap;
  MemoryFrameSink sink;
  SimulatedPlatform::Script script;
  script.realTime = false;
  script.micBlocks = 50;
  script.systemStopsAfterBlocks = 20;
  SimulatedPlatform platform(script);
  RecorderOptions opt;
  opt.echoCancellation = false;
  opt.systemRetryDelay = std::chrono::milliseconds(50);
  {
    Recorder rec(platform, sink, cap.emitter, opt);
    rec.start();
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    rec.stop();
  }
  std::string all;
  for (auto& l : cap.lines) all += l + "\n";
  CHECK(all.find("captura do sistema parou, reiniciando") != std::string::npos);
  CHECK_EQ(platform.systemOpens(), 2);
  CHECK(all.find("\"fatal\":true") == std::string::npos);
}
