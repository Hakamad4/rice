#ifndef RICE_APM_H
#define RICE_APM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Cancelador de eco (WebRTC AEC3) para 16 kHz mono, quadros de 10 ms (160 amostras).
typedef struct rice_apm rice_apm;

rice_apm *rice_apm_create(int sample_rate_hz);
/// Áudio que está tocando no Mac (referência). Retorna 0 em sucesso.
int rice_apm_process_render(rice_apm *apm, const int16_t *frame, int samples);
/// Microfone: processado no lugar. Retorna 0 em sucesso.
int rice_apm_process_capture(rice_apm *apm, int16_t *frame, int samples);
void rice_apm_set_stream_delay_ms(rice_apm *apm, int delay_ms);
void rice_apm_destroy(rice_apm *apm);

#ifdef __cplusplus
}
#endif

#endif
