// Decide se a saída de áudio padrão é fone (AEC desligado) ou alto-falante (AEC ligado), a partir do que o sistema
// informa. Portável: o lado Win32 só lê nome e tipo do endpoint.
#pragma once

#include <string>

#include "platform.hpp"

namespace rice {

/// Valores de PKEY_AudioEndpoint_FormFactor (mmdeviceapi.h) que importam.
enum class EndpointForm { Unknown = -1, RemoteNetworkDevice = 0, Speakers = 1, LineLevel = 2, Headphones = 3, Microphone = 4, Headset = 5, Handset = 6, UnknownDigitalPassthrough = 7, SPDIF = 8, DigitalAudioDisplayDevice = 9, UnknownFormFactor = 10 };

OutputInfo classifyOutput(const std::string& name, int formFactor, bool bluetooth);

}  // namespace rice
