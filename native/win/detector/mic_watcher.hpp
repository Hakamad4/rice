// Transforma snapshots de "quem usa o mic" em eventos de transição por app (port do MicWatcher.swift).
#pragma once

#include <map>
#include <string>
#include <vector>

#include "../common/events.hpp"

namespace rice {

class MicWatcher {
 public:
  explicit MicWatcher(LineEmitter& out) : out_(out) {}
  void tick(const std::vector<std::string>& identifiers);

 private:
  LineEmitter& out_;
  std::map<std::string, std::string> activeApps_;  // app -> primeiro identificador visto (std::map = ordem alfabética)
};

}  // namespace rice
