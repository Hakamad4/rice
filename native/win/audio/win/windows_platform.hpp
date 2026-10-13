// Plataforma Windows: WASAPI (mic em modo evento, loopback do dispositivo de saída padrão), IMMNotificationClient,
// PowerRequest. Só compila no Windows; o resto do rice-audio é portável.
#pragma once

#ifdef _WIN32

#include <memory>

#include "../../common/events.hpp"
#include "../platform.hpp"

namespace rice {

std::unique_ptr<Platform> makeWindowsPlatform(LineEmitter& events);

}  // namespace rice

#endif
