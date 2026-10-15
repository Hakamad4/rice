#include "mic_device.hpp"

namespace rice {

MicChoice chooseMic(const std::string& preferred, const std::vector<InputDevice>& inputs) {
  MicChoice choice;
  if (!preferred.empty()) {
    for (const auto& d : inputs) {
      if (d.id == preferred) {
        choice.id = d.id;
        choice.name = d.name;
        choice.isDefault = d.isDefault;
        choice.preferredActive = true;
        return choice;
      }
    }
  }
  for (const auto& d : inputs) {
    if (d.isDefault) {
      choice.id = d.id;
      choice.name = d.name;
      choice.isDefault = true;
      return choice;
    }
  }
  return choice;
}

bool MicDeviceTracker::update(const std::string& preferred, const std::vector<InputDevice>& inputs, MicDeviceInfo& info) {
  MicChoice now = chooseMic(preferred, inputs);
  const bool first = !has_;
  const bool changed = first || now.id != lastId_;
  const bool wasPreferred = lastPreferredActive_;
  has_ = true;
  lastId_ = now.id;
  lastPreferredActive_ = now.preferredActive;
  if (!changed) return false;
  info.id = now.id;
  info.name = now.name;
  info.isDefault = now.isDefault;
  info.chosen = now.preferredActive;
  if (first) info.reason = "open";
  else if (now.preferredActive) info.reason = "preferred-returned";
  else if (wasPreferred) info.reason = "preferred-missing";
  else info.reason = "default-changed";
  return true;
}

json::Value inputDeviceToJson(const InputDevice& d) {
  json::Value o = json::Value::object();
  o.set("id", d.id).set("name", d.name).set("isDefault", d.isDefault).set("state", d.state);
  return o;
}

json::Value inputsToJson(const std::vector<InputDevice>& devices) {
  json::Value list = json::Value::array();
  for (const auto& d : devices) list.push(inputDeviceToJson(d));
  return list;
}

std::vector<InputDevice> inputsFromJson(const json::Value& array) {
  std::vector<InputDevice> out;
  if (!array.isArray()) return out;
  for (const auto& o : array.items()) {
    if (!o.isObject() || o.getString("id").empty()) continue;
    InputDevice d;
    d.id = o.getString("id");
    d.name = o.getString("name");
    const json::Value* def = o.get("isDefault");
    d.isDefault = def && def->boolean();
    d.state = o.getString("state", "active");
    out.push_back(std::move(d));
  }
  return out;
}

json::Value micDeviceFields(const MicDeviceInfo& info) {
  json::Value f = json::Value::object();
  f.set("id", info.id).set("name", info.name).set("isDefault", info.isDefault).set("chosen", info.chosen).set("reason", info.reason);
  return f;
}

}  // namespace rice
