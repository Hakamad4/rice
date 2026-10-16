import AVFoundation
import CoreAudio

final class Recorder {
    private let sink: FrameSink
    private let echoCancellation: Bool
    private let aec: EchoCanceller?
    private let sleepGuard = SleepGuard()
    private let deviceQueue = DispatchQueue(label: "rice.audio.devices")
    private var outputListener: AudioObjectPropertyListenerBlock?
    private var startTime = DispatchTime.now()
    private let lock = NSLock()
    private let micChunker: Chunker
    private let sysChunker: Chunker
    private var mic: MicCapture?
    private var system: SystemAudioCapture?
    private var running = false
    private var stopRequested = false
    private var systemRestarted = false
    private var usingTap = false

    enum SystemSource { case auto, tap, sck }
    private let systemSource: SystemSource
    private let excludePIDs: [pid_t]
    private var micDeviceUID: String?

    init(sink: FrameSink, echoCancellation: Bool, systemSource: SystemSource = .auto, excludePIDs: [pid_t] = [], micDeviceUID: String? = nil) {
        self.micDeviceUID = micDeviceUID
        self.systemSource = systemSource
        self.excludePIDs = excludePIDs
        self.sink = sink
        self.echoCancellation = echoCancellation
        self.aec = echoCancellation ? EchoCanceller() : nil
        self.micChunker = Chunker(source: .mic, sink: sink)
        self.sysChunker = Chunker(source: .sys, sink: sink)
    }

    private func elapsedMs() -> UInt64 {
        (DispatchTime.now().uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000
    }

    private var isStopRequested: Bool {
        lock.withLock { stopRequested }
    }

    func start() async {
        let accepted = lock.withLock {
            guard !running, !stopRequested else { return false }
            running = true
            startTime = DispatchTime.now()
            return true
        }
        guard accepted else { return }

        sleepGuard.begin()
        configureEchoCancellation()
        let micOk = await startMic()
        if isStopRequested {
            mic?.stop()
            endDeviceWork()
            return
        }
        let sysOk = await startSystem()
        if isStopRequested {
            mic?.stop()
            await system?.stop()
            endDeviceWork()
            return
        }
        Events.emit("started", ["mic": micOk, "sys": sysOk])
    }

    /// Troca o microfone durante a gravação (`nil` = padrão do macOS).
    func switchMic(to uid: String?) {
        micDeviceUID = uid
        mic?.switchDevice(to: uid)
    }

    /// Para a gravação. Também cancela um start em andamento: o start vê o flag
    /// depois de cada etapa e desfaz o que já tinha iniciado.
    func stop() async {
        let wasRunning = lock.withLock {
            let was = running
            running = false
            stopRequested = true
            return was
        }
        guard wasRunning else { return }
        mic?.stop()
        await system?.stop()
        endDeviceWork()
        if let aec {
            let rest = aec.drainCapture()
            if !rest.isEmpty { micChunker.append(rest, nowMs: elapsedMs()) }
        }
        micChunker.flush()
        sysChunker.flush()
        Events.emit("stopped")
    }

    private func startMic() async -> Bool {
        guard await AVCaptureDevice.requestAccess(for: .audio) else {
            Events.emit("error", ["source": "mic", "message": "permissão de microfone negada"])
            return false
        }
        let capture = MicCapture(
            deviceUID: micDeviceUID,
            onSamples: { [weak self] samples in
                guard let self else { return }
                let cleaned = self.aec?.processCapture(samples) ?? samples
                if !cleaned.isEmpty { self.micChunker.append(cleaned, nowMs: self.elapsedMs()) }
            },
            onDeviceChanged: { Events.emit("device-changed") }
        )
        capture.onDevice = { uid, name, isDefault, chosen, reason in
            Events.emit("mic-device", ["id": uid, "name": name, "isDefault": isDefault, "chosen": chosen, "reason": reason])
        }
        do {
            try capture.start()
            mic = capture
            return true
        } catch {
            Events.emit("error", ["source": "mic", "message": error.localizedDescription])
            return false
        }
    }

    /// AEC ligado com alto-falante, desligado com fone (não há eco a remover e o AEC só
    /// estragaria a voz). Reavaliado quando a saída padrão muda.
    private func configureEchoCancellation() {
        guard echoCancellation else {
            Events.emit("aec", ["enabled": false, "reason": "desligado por --no-aec"])
            return
        }
        guard let aec else {
            Events.emit("aec", ["enabled": false, "reason": "falha ao iniciar o WebRTC AEC3"])
            return
        }
        let apply = {
            let output = OutputDevice.current()
            aec.setEnabled(!output.isHeadphones)
            Events.emit("aec", ["enabled": !output.isHeadphones, "reason": output.reason])
        }
        apply()
        if outputListener == nil {
            outputListener = OutputDevice.observeDefaultOutput(queue: deviceQueue) { apply() }
        }
    }

    private func endDeviceWork() {
        if let outputListener {
            OutputDevice.stopObserving(queue: deviceQueue, outputListener)
            self.outputListener = nil
        }
        sleepGuard.end()
    }

    private func makeSystemCapture(useTap: Bool) -> SystemAudioCapture {
        let onSamples: ([Int16]) -> Void = { [weak self] samples in
            guard let self else { return }
            self.aec?.pushRender(samples)
            self.sysChunker.append(samples, nowMs: self.elapsedMs())
        }
        let onStopped: (Error) -> Void = { [weak self] error in
            guard let self else { return }
            Task { await self.handleSystemStopped(error) }
        }
        if useTap, #available(macOS 14.2, *) {
            return ProcessTapCapture(excludePIDs: excludePIDs, onSamples: onSamples, onStopped: onStopped)
        }
        return SystemCapture(onSamples: onSamples, onStopped: onStopped)
    }

    /// Tap por padrão; se falhar, cai para o ScreenCaptureKit (a menos que o tap tenha sido forçado).
    private func startSystemCapture() async throws -> SystemAudioCapture {
        if systemSource != .sck {
            let tap = makeSystemCapture(useTap: true)
            do {
                try await tap.start()
                usingTap = true
                return tap
            } catch {
                if systemSource == .tap { throw error }
                Events.emit("warning", ["source": "sys", "message": "process tap indisponível: \(error.localizedDescription); usando ScreenCaptureKit"])
            }
        }
        let sck = makeSystemCapture(useTap: false)
        try await sck.start()
        usingTap = false
        return sck
    }

    private func startSystem() async -> Bool {
        do {
            system = try await startSystemCapture()
            return true
        } catch {
            Events.emit("error", ["source": "sys", "message": error.localizedDescription])
            return false
        }
    }

    /// A captura do sistema parou sozinha: tenta reiniciar uma vez após 1 s; se falhar
    /// (ou se parar de novo depois), o erro é fatal para o chamador decidir o que fazer.
    private func handleSystemStopped(_ error: Error) async {
        let canRetry = lock.withLock { () -> Bool in
            guard running, !stopRequested, !systemRestarted else { return false }
            systemRestarted = true
            return true
        }
        guard canRetry else {
            if !isStopRequested {
                Events.emit("error", ["source": "sys", "message": "captura do sistema parou: \(error.localizedDescription)", "fatal": true])
            }
            return
        }
        Events.emit("error", ["source": "sys", "message": "captura do sistema parou, reiniciando: \(error.localizedDescription)"])
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        if isStopRequested { return }
        do {
            let capture = try await startSystemCapture()
            system = capture
            if isStopRequested { await capture.stop() }
        } catch {
            Events.emit("error", ["source": "sys", "message": "falha ao reiniciar a captura do sistema: \(error.localizedDescription)", "fatal": true])
        }
    }
}
