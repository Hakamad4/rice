// rice-audio (Windows e portátil): mesmo protocolo do helper Swift. Ver native/PROTOCOL.md.
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "../common/events.hpp"
#include "../common/json.hpp"
#include "recorder.hpp"
#include "selftests.hpp"
#include "simulated_platform.hpp"
#include "sinks.hpp"

#ifdef _WIN32
#include "win/windows_platform.hpp"
#endif

using namespace rice;

namespace {

struct Args {
  std::vector<std::string> all;
  bool has(const std::string& flag) const {
    for (const auto& a : all) {
      if (a == flag) return true;
    }
    return false;
  }
  std::string value(const std::string& flag) const {
    for (size_t i = 0; i + 1 < all.size(); i++) {
      if (all[i] == flag) return all[i + 1];
    }
    return "";
  }
  bool hasValue(const std::string& flag) const {
    for (size_t i = 0; i + 1 < all.size(); i++) {
      if (all[i] == flag) return true;
    }
    return false;
  }
};

/// Sistema sem captura (fora do Windows e sem --simulate-capture): o protocolo funciona, as fontes falham ao abrir.
class UnavailablePlatform : public Platform {
 public:
  std::unique_ptr<CaptureHandle> startMic(BlockCallback, std::function<void()>, std::function<void(std::string)>, std::string& error, CaptureFailure&) override {
    error = "captura de áudio indisponível neste sistema (use --simulate-capture)";
    return nullptr;
  }
  std::unique_ptr<CaptureHandle> startSystem(BlockCallback, std::function<void(std::string)>, const std::vector<long>&, std::string& error) override {
    error = "captura de áudio indisponível neste sistema (use --simulate-capture)";
    return nullptr;
  }
  OutputInfo currentOutput() override { return {"?", false, "sem saída padrão"}; }
  std::function<void()> observeOutput(std::function<void()>) override { return [] {}; }
  bool preventSleep(std::string&) override { return true; }
  void allowSleep() override {}
};

std::unique_ptr<Platform> makePlatform(const Args& args, LineEmitter& events) {
  // RICE_AUDIO_SIMULATE=1: o mesmo modo simulado, para o main do Electron (que não passa argumentos extras) nos smoke tests.
  const char* simulateEnv = std::getenv("RICE_AUDIO_SIMULATE");
  if (args.has("--simulate-capture") || (simulateEnv && *simulateEnv == '1')) return std::make_unique<SimulatedPlatform>();
#ifdef _WIN32
  return makeWindowsPlatform(events);
#else
  (void)events;
  return std::make_unique<UnavailablePlatform>();
#endif
}

void emitError(LineEmitter& events, const std::string& message) {
  json::Value f = json::Value::object();
  f.set("source", "cli").set("message", message);
  events.emit("error", std::move(f));
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);  // os frames não podem ganhar \r
#endif
  Args args;
  for (int i = 1; i < argc; i++) args.all.emplace_back(argv[i]);
  LineEmitter events = makeStderrEmitter();

  if (args.has("--selftest-tone") || args.has("--selftest-gap")) {
    StdoutFrameSink sink(stdout, events);
    if (args.has("--selftest-tone")) runToneSelfTest(sink, events);
    else runGapSelfTest(sink, events);
    sink.drain();
    return 0;
  }
  if (args.has("--selftest-aec")) {
    std::string line = runAecSelfTest(events);
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
    return 0;
  }

  RecorderOptions options;
  // O AEC só entra se o build o inclui; --no-aec sempre desliga.
  options.echoCancellation = EchoCanceller::compiledIn() && !args.has("--no-aec");
  for (size_t i = 0; i + 1 < args.all.size(); i++) {
    if (args.all[i] == "--exclude-pid") options.excludePids.push_back(std::strtol(args.all[i + 1].c_str(), nullptr, 10));
  }

  std::unique_ptr<Platform> platform = makePlatform(args, events);

  // Modo manual: grava N segundos em arquivos.
  if (args.hasValue("--seconds") && args.hasValue("--out-dir")) {
    double seconds = std::strtod(args.value("--seconds").c_str(), nullptr);
    try {
      FileFrameSink sink(args.value("--out-dir"));
      Recorder recorder(*platform, sink, events, options);
      recorder.start();
      std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long long>(seconds * 1000)));
      recorder.stop();
      return 0;
    } catch (const std::exception& e) {
      emitError(events, e.what());
      return 1;
    }
  }

  // Modo controle: stdout só com frames; comandos no stdin.
  StdoutFrameSink sink(stdout, events);
  Recorder recorder(*platform, sink, events, options);
  std::atomic<bool> shuttingDown{false};

  auto shutdown = [&] {
    if (shuttingDown.exchange(true)) return;
    // Watchdog: sai em 3 s mesmo se a captura travar.
    std::thread([] {
      std::this_thread::sleep_for(std::chrono::seconds(3));
      std::fflush(stdout);
      std::_Exit(0);
    }).detach();
    std::thread([&] {
      recorder.stop();
      sink.drain();
      std::fflush(stdout);
      std::_Exit(0);
    }).detach();
  };

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    auto command = json::parseCommand(line);
    if (!command) {
      emitError(events, "invalid command line");
      continue;
    }
    if (command->name == "start") {
      // Não espera o start: stop/EOF precisam ser vistos mesmo com um start preso.
      std::thread([&] { recorder.start(); }).detach();
    } else if (command->name == "stop") {
      shutdown();
    } else {
      emitError(events, "unknown command: " + command->name);
    }
  }
  // EOF: o processo pai fechou o stdin (ou morreu). Para e sai.
  shutdown();
  for (;;) std::this_thread::sleep_for(std::chrono::seconds(60));  // o _Exit das threads de shutdown encerra
}
