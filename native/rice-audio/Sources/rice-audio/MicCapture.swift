import AVFoundation
import CoreAudio

final class MicCapture {
    private var engine = AVAudioEngine()
    private let resampler = Resampler()
    private let onSamples: ([Int16]) -> Void
    private let onDeviceChanged: () -> Void
    private var observer: NSObjectProtocol?
    /// Microfone escolhido (UID do CoreAudio); nil = entrada padrão do macOS (o comportamento de sempre).
    private var deviceUID: String?
    private var openReason = "open"
    private var startedAt = Date.distantPast
    private var startedDevice: AudioDeviceID?
    /// Quem abriu e qual: informa o dispositivo realmente em uso (evento `mic-device`).
    var onDevice: ((_ uid: String, _ name: String, _ isDefault: Bool, _ chosen: Bool, _ reason: String) -> Void)?

    /// Captura simples do microfone (HAL, sem o voice processing da Apple): o eco é
    /// removido depois pelo `EchoCanceller` (AEC3).
    init(deviceUID: String? = nil, onSamples: @escaping ([Int16]) -> Void, onDeviceChanged: @escaping () -> Void) {
        self.deviceUID = deviceUID
        self.onSamples = onSamples
        self.onDeviceChanged = onDeviceChanged
    }

    func start() throws {
        do {
            let input = engine.inputNode
            let custom = applyDevice(to: input)
            // Entrada padrão: igual a sempre (com o mixer). Dispositivo escolhido: sem o mixer, senão o engine liga a SAÍDA ao mesmo dispositivo (só entrada) e falha ao iniciar.
            if !custom { _ = engine.mainMixerNode } // garante um grafo válido para o engine iniciar
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
                guard let self else { return }
                let samples = self.resampler.convert(buffer)
                if !samples.isEmpty { self.onSamples(samples) }
            }
            observer = NotificationCenter.default.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
            ) { [weak self] _ in
                guard let self else { return }
                // Com microfone escolhido, o próprio engine avisa de uma reconfiguração logo ao iniciar: reabrir de novo geraria um laço.
                // Só ignora o aviso colado no início e com o mesmo dispositivo; no padrão, nada muda.
                if self.deviceUID != nil, Date().timeIntervalSince(self.startedAt) < 1.0, let dev = self.startedDevice, dev == self.currentDeviceID() { return }
                self.restartAfterDeviceChange()
            }
            engine.prepare()
            try engine.start()
            startedAt = Date()
            startedDevice = currentDeviceID()
            reportDevice(of: input)
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    /// Troca o microfone no meio da gravação: reabre pelo mesmo caminho da troca de dispositivo (sem mexer em mais nada).
    func switchDevice(to uid: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.deviceUID = uid
            self.openReason = "switched"
            self.restartAfterDeviceChange()
        }
    }

    /// Aponta a entrada do engine para o dispositivo escolhido ANTES de iniciar. UID que sumiu (fone desconectado): fica no padrão.
    private func applyDevice(to input: AVAudioInputNode) -> Bool {
        guard let uid = deviceUID else { return false }
        guard let device = InputDevices.deviceID(forUID: uid), let unit = input.audioUnit else {
            openReason = "preferred-missing"
            return false
        }
        var id = device
        let status = AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size))
        if status != noErr { openReason = "preferred-missing" }
        return status == noErr
    }

    private func currentDeviceID() -> AudioDeviceID? {
        guard let unit = engine.inputNode.audioUnit else { return nil }
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        return AudioUnitGetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, &size) == noErr ? id : nil
    }

    /// Evento `mic-device` com o dispositivo que o engine realmente abriu.
    private func reportDevice(of input: AVAudioInputNode) {
        guard let unit = input.audioUnit else { return }
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioUnitGetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, &size) == noErr,
              var uid = InputDevices.uid(of: id) else { return }
        // Na entrada padrão o engine usa um agregado próprio ("CADefaultDeviceAggregate-…"): informa a entrada padrão de verdade.
        if uid.hasPrefix("CADefaultDeviceAggregate"), let real = InputDevices.defaultInputID(), let realUID = InputDevices.uid(of: real) {
            id = real
            uid = realUID
        }
        let reason = openReason
        openReason = deviceUID == nil ? "default-changed" : "open"
        onDevice?(uid, InputDevices.name(of: id) ?? uid, id == InputDevices.defaultInputID(), deviceUID == uid, reason)
    }

    private func restartAfterDeviceChange() {
        stop()
        var lastError: Error?
        for attempt in 1...3 {
            engine = AVAudioEngine()
            do {
                try start()
                onDeviceChanged()
                return
            } catch {
                lastError = error
                if attempt < 3 {
                    Thread.sleep(forTimeInterval: 0.5)
                }
            }
        }
        let message = "mic restart failed: \(lastError?.localizedDescription ?? "unknown error")"
        Events.emit("error", ["source": "mic", "message": message, "fatal": true])
    }
}
