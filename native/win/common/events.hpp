// Uma linha JSON por mensagem, serializada (várias threads emitem). O destino é injetável para os testes.
#pragma once

#include <functional>
#include <mutex>
#include <string>

#include "json.hpp"

namespace rice {

class LineEmitter {
 public:
  using Writer = std::function<void(const std::string& line)>;  // recebe a linha sem o "\n"

  explicit LineEmitter(Writer writer) : writer_(std::move(writer)) {}

  /// {"event": name, ...fields} com chaves em ordem.
  void emit(const std::string& event, json::Value fields = json::Value::object()) {
    fields.set("event", event);
    std::lock_guard<std::mutex> lock(mutex_);
    writer_(fields.dump());
  }

 private:
  std::mutex mutex_;
  Writer writer_;
};

/// stderr (rice-audio) ou stdout (rice-detector), com "\n" e flush a cada linha.
LineEmitter makeStderrEmitter();
LineEmitter makeStdoutEmitter();

}  // namespace rice
