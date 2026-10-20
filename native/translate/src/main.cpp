// rice-translate: sidecar de tradução offline (OPUS-MT em CTranslate2 int8). Protocolo de linhas JSON no stdin/stdout, como os outros
// helpers (ver native/PROTOCOL.md). Um processo = uma sessão de tradução; sem modelo carregado ele não gasta RAM.
#include <chrono>
#include <cstdio>
#include <iostream>
#include <string>

#include "../../win/common/events.hpp"
#include "../../win/common/json.hpp"
#include "core.hpp"
#ifdef RICE_WITH_CT2
#include "ct2_model.hpp"
#endif

using namespace rice;

int main(int argc, char** argv) {
  bool simulate = false;
  size_t threads = 1, beam = 4, capacity = 2;
  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    if (a == "--simulate") simulate = true;
    else if (a == "--threads" && i + 1 < argc) threads = static_cast<size_t>(std::max(1, std::atoi(argv[++i])));
    else if (a == "--beam" && i + 1 < argc) beam = static_cast<size_t>(std::max(1, std::atoi(argv[++i])));
    else if (a == "--cache" && i + 1 < argc) capacity = static_cast<size_t>(std::max(1, std::atoi(argv[++i])));
  }
  std::ios::sync_with_stdio(false);
  auto out = makeStdoutEmitter();

  translate::ModelLoader loader;
  std::string backend = "simulated";
  if (simulate) {
    loader = translate::makeSimulatedModel;
  } else {
#ifdef RICE_WITH_CT2
    backend = translate::ct2BackendName();
    loader = [threads, beam](const std::string& dir) { return translate::loadCt2Model(dir, threads, beam); };
#else
    out.emit("error", json::Value::object().set("message", "rice-translate built without CTranslate2 (use --simulate)"));
    return 2;
#endif
  }
  translate::ModelCache cache(loader, capacity);
  out.emit("ready", json::Value::object().set("backend", backend).set("threads", static_cast<long long>(threads)));

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    const auto cmd = json::parseCommand(line);
    if (!cmd) {
      out.emit("error", json::Value::object().set("message", "invalid command line"));
      continue;
    }
    if (cmd->name == "quit") break;
    if (cmd->name == "unload") {
      cache.unload(cmd->body.getString("model"));
      out.emit("unloaded", json::Value::object().set("loaded", static_cast<long long>(cache.size())));
      continue;
    }
    if (cmd->name == "translate") {
      const auto* idv = cmd->body.get("id");
      const long long id = idv && idv->isNumber() ? idv->integer() : 0;
      auto fail = [&](const std::string& message) { out.emit("error", json::Value::object().set("id", id).set("message", message)); };
      const std::string model = cmd->body.getString("model");
      const std::string text = cmd->body.getString("text");
      if (model.empty()) { fail("missing model"); continue; }
      try {
        const auto t0 = std::chrono::steady_clock::now();
        auto& m = cache.get(model);
        const auto parts = translate::splitSentences(text);
        std::string joined;
        if (!parts.empty()) {
          const auto tr = m.translate(parts, cmd->body.getString("prefix"));
          for (const auto& s : tr) joined += (joined.empty() ? "" : " ") + s;
        }
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
        out.emit("translated", json::Value::object().set("id", id).set("text", joined).set("ms", static_cast<long long>(ms)));
      } catch (const std::exception& e) {
        fail(e.what());
      }
      continue;
    }
    out.emit("error", json::Value::object().set("message", "unknown command: " + cmd->name));
  }
  return 0;
}
