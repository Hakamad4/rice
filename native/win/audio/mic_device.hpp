// Escolha do microfone: lógica portável (testada em qualquer sistema) usada pela plataforma Windows e pela simulada.
// Sem preferência, vale o padrão do sistema (e segue as trocas). Com preferência, vale aquele endpoint; se sumir, volta ao padrão
// e, se ele reaparecer, retoma. Cada mudança do dispositivo em uso vira um evento aditivo `mic-device` (ver native/PROTOCOL.md).
#pragma once

#include <string>
#include <vector>

#include "../common/json.hpp"

namespace rice {

struct InputDevice {
  std::string id;    // id do endpoint (Windows: IMMDevice::GetId)
  std::string name;  // nome amigável, ex.: "Microfone (FIFINE K669)"
  bool isDefault = false;
  std::string state = "active";
};

struct MicDeviceInfo {
  std::string id;
  std::string name;
  bool isDefault = false;  // é o padrão do sistema
  bool chosen = false;     // é o microfone que o usuário escolheu (--mic-device) e ele está em uso
  std::string reason;      // open | default-changed | preferred-missing | preferred-returned
};

/// Quem usar: `preferred` vazio = padrão. nullptr-like (id vazio) se não há nenhuma entrada.
struct MicChoice {
  std::string id;
  std::string name;
  bool isDefault = false;
  bool preferredActive = false;  // a preferência existe e está em uso
};
MicChoice chooseMic(const std::string& preferred, const std::vector<InputDevice>& inputs);

/// Guarda o último dispositivo e diz quando mudou (e por quê).
class MicDeviceTracker {
 public:
  /// Reavalia. Devolve true (e preenche `info`) se o dispositivo em uso mudou ou é a primeira vez.
  bool update(const std::string& preferred, const std::vector<InputDevice>& inputs, MicDeviceInfo& info);
  void reset() { has_ = false; }

 private:
  bool has_ = false;
  std::string lastId_;
  bool lastPreferredActive_ = false;
};

json::Value inputDeviceToJson(const InputDevice& device);
json::Value inputsToJson(const std::vector<InputDevice>& devices);
std::vector<InputDevice> inputsFromJson(const json::Value& array);
json::Value micDeviceFields(const MicDeviceInfo& info);

}  // namespace rice
