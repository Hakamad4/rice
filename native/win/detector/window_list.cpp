#include "window_list.hpp"

#include <algorithm>
#include <cctype>

#include "app_matcher.hpp"

namespace rice {

namespace {

std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

}  // namespace

std::string windowOwner(const WindowInfo& window) {
  if (auto app = matchApp(window.exe)) return *app;
  std::string name = window.exe;
  if (name.size() > 4 && lower(name.substr(name.size() - 4)) == ".exe") name.resize(name.size() - 4);
  return name;
}

std::vector<WindowInfo> filterWindows(const std::vector<WindowInfo>& windows, const WindowFilter& filter) {
  if (filter.empty()) return windows;
  std::vector<WindowInfo> out;
  for (const WindowInfo& w : windows) {
    bool keep = std::find(filter.pids.begin(), filter.pids.end(), w.pid) != filter.pids.end();
    for (size_t i = 0; !keep && i < filter.exes.size(); i++) keep = lower(filter.exes[i]) == lower(w.exe);
    if (!keep && !filter.apps.empty()) {
      auto app = matchApp(w.exe);
      for (size_t i = 0; !keep && app && i < filter.apps.size(); i++) keep = filter.apps[i] == *app;
    }
    if (keep) out.push_back(w);
  }
  return out;
}

json::Value windowsToJson(const std::vector<WindowInfo>& windows) {
  json::Value list = json::Value::array();
  for (const WindowInfo& w : windows) {
    json::Value o = json::Value::object();
    o.set("id", w.hwnd).set("owner", windowOwner(w)).set("pid", w.pid).set("title", w.title);
    o.set("x", w.x).set("y", w.y).set("w", w.w).set("h", w.h);
    o.set("exe", w.exe).set("monitor", w.monitor).set("mx", w.mx).set("my", w.my).set("mw", w.mw).set("mh", w.mh);
    list.push(std::move(o));
  }
  return list;
}

std::vector<WindowInfo> windowsFromJson(const json::Value& array) {
  std::vector<WindowInfo> out;
  if (!array.isArray()) return out;
  auto num = [](const json::Value& o, const char* key) {
    const json::Value* v = o.get(key);
    return v && v->isNumber() ? v->integer() : 0;
  };
  for (const json::Value& o : array.items()) {
    if (!o.isObject() || !o.get("id") || !o.get("id")->isNumber()) continue;
    WindowInfo w;
    w.hwnd = num(o, "id");
    w.pid = static_cast<unsigned long>(num(o, "pid"));
    w.exe = o.getString("exe");
    w.title = o.getString("title");
    w.x = static_cast<int>(num(o, "x"));
    w.y = static_cast<int>(num(o, "y"));
    w.w = static_cast<int>(num(o, "w"));
    w.h = static_cast<int>(num(o, "h"));
    w.monitor = num(o, "monitor");
    w.mx = static_cast<int>(num(o, "mx"));
    w.my = static_cast<int>(num(o, "my"));
    w.mw = static_cast<int>(num(o, "mw"));
    w.mh = static_cast<int>(num(o, "mh"));
    out.push_back(std::move(w));
  }
  return out;
}

#ifndef _WIN32
std::vector<WindowInfo> enumerateWindows() { return {}; }
void enableDpiAwareness() {}
#endif

}  // namespace rice
