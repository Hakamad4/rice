#include "mic_watcher.hpp"

#include "app_matcher.hpp"

namespace rice {

void MicWatcher::tick(const std::vector<std::string>& identifiers) {
  std::map<std::string, std::string> current;
  for (const std::string& id : identifiers) {
    auto app = matchApp(id);
    if (!app || current.count(*app)) continue;
    auto known = activeApps_.find(*app);
    current[*app] = known != activeApps_.end() ? known->second : id;
  }
  auto fields = [](const std::string& app, const std::string& id) {
    json::Value f = json::Value::object();
    f.set("app", app).set("bundleId", id);
    return f;
  };
  for (const auto& [app, id] : current) {
    if (!activeApps_.count(app)) out_.emit("mic-in-use", fields(app, id));
  }
  for (const auto& [app, id] : activeApps_) {
    if (!current.count(app)) out_.emit("mic-released", fields(app, id));
  }
  activeApps_ = std::move(current);
}

}  // namespace rice
