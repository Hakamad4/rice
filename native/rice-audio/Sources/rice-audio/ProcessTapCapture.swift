import AVFoundation
import CoreAudio

enum TapError: Error, LocalizedError {
    case osStatus(String, OSStatus)
    case invalidFormat

    var errorDescription: String? {
        switch self {
        case let .osStatus(step, status): return "\(step) falhou (OSStatus \(status))"
        case .invalidFormat: return "formato do tap inválido"
        }
    }
}

/// Captura do áudio do sistema inteiro (mixdown mono) por um Core Audio process tap,
/// lido por um dispositivo agregado privado. Se o formato do tap, a taxa de amostragem ou
/// o próprio agregado mudarem (troca de saída, fone conectado), recria tudo.
@available(macOS 14.2, *)
final class ProcessTapCapture: SystemAudioCapture {
    private let excludePIDs: [pid_t]
    private let resampler = Resampler()
    private let queue = DispatchQueue(label: "rice.audio.tap", qos: .userInteractive)
    private let onSamples: ([Int16]) -> Void
    private let onStopped: (Error) -> Void
    private let control = DispatchQueue(label: "rice.audio.tap.control")
    private var listeners: [(AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []
    private var format: AVAudioFormat?
    private var stopped = false

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private var deviceStarted = false

    init(excludePIDs: [pid_t], onSamples: @escaping ([Int16]) -> Void, onStopped: @escaping (Error) -> Void) {
        self.excludePIDs = excludePIDs
        self.onSamples = onSamples
        self.onStopped = onStopped
    }

    func start() async throws {
        try control.sync {
            stopped = false
            do {
                try startSync()
            } catch {
                teardown()
                throw error
            }
        }
    }

    func stop() async {
        control.sync {
            stopped = true
            teardown()
        }
    }

    /// Chamado na fila `control` quando uma propriedade observada muda.
    private func restart(reason: String) {
        guard !stopped else { return }
        Events.emit("warning", ["source": "sys", "message": "áudio do sistema mudou (\(reason)); reiniciando o tap"])
        teardown()
        do {
            try startSync()
        } catch {
            teardown()
            stopped = true
            onStopped(error)
        }
    }

    private func startSync() throws {
        var excluded: [AudioObjectID] = []
        for pid in Set(excludePIDs + [getpid()]) {
            if let object = Self.processObject(for: pid) { excluded.append(object) }
        }

        let description = CATapDescription(monoGlobalTapButExcludeProcesses: excluded)
        description.name = "Rice-Tap"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        var status = AudioHardwareCreateProcessTap(description, &tapID)
        guard status == noErr else { throw TapError.osStatus("AudioHardwareCreateProcessTap", status) }

        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &asbd)
        guard status == noErr else { throw TapError.osStatus("kAudioTapPropertyFormat", status) }
        guard let tapFormat = AVAudioFormat(streamDescription: &asbd) else { throw TapError.invalidFormat }
        format = tapFormat

        let tapUID = description.uuid.uuidString
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Rice-Tap-\(UUID().uuidString)",
            kAudioAggregateDeviceUIDKey: "Rice-Tap-\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapUIDKey: tapUID,
                    kAudioSubTapDriftCompensationKey: true,
                ],
            ],
        ]
        status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID)
        guard status == noErr else { throw TapError.osStatus("AudioHardwareCreateAggregateDevice", status) }

        status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, queue) { [weak self] _, input, _, _, _ in
            guard let self,
                  let buffer = AVAudioPCMBuffer(pcmFormat: tapFormat, bufferListNoCopy: input, deallocator: nil),
                  buffer.frameLength > 0 else { return }
            let samples = self.resampler.convert(buffer)
            if !samples.isEmpty { self.onSamples(samples) }
        }
        guard status == noErr, ioProcID != nil else { throw TapError.osStatus("AudioDeviceCreateIOProcIDWithBlock", status) }

        status = AudioDeviceStart(aggregateID, ioProcID)
        guard status == noErr else { throw TapError.osStatus("AudioDeviceStart", status) }
        deviceStarted = true

        listen(tapID, kAudioTapPropertyFormat, "formato do tap")
        listen(aggregateID, kAudioDevicePropertyNominalSampleRate, "taxa de amostragem")
        listen(aggregateID, kAudioDevicePropertyDeviceIsAlive, "dispositivo agregado")
    }

    private func listen(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ reason: String) {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.restart(reason: reason)
        }
        if AudioObjectAddPropertyListenerBlock(object, &address, control, block) == noErr {
            listeners.append((object, address, block))
        }
    }

    private func warnIfFailed(_ status: OSStatus, _ step: String) {
        guard status != noErr else { return }
        Events.emit("warning", ["source": "sys", "message": "falha ao encerrar a captura do sistema em \(step) (código \(status))"])
    }

    private func teardown() {
        for (object, address, block) in listeners {
            var address = address
            AudioObjectRemovePropertyListenerBlock(object, &address, control, block)
        }
        listeners.removeAll()
        if deviceStarted, let ioProcID {
            warnIfFailed(AudioDeviceStop(aggregateID, ioProcID), "AudioDeviceStop")
        }
        deviceStarted = false
        if let proc = ioProcID {
            warnIfFailed(AudioDeviceDestroyIOProcID(aggregateID, proc), "AudioDeviceDestroyIOProcID")
            ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            warnIfFailed(AudioHardwareDestroyAggregateDevice(aggregateID), "AudioHardwareDestroyAggregateDevice")
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            warnIfFailed(AudioHardwareDestroyProcessTap(tapID), "AudioHardwareDestroyProcessTap")
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    private static func processObject(for pid: pid_t) -> AudioObjectID? {
        var pidValue = pid
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address,
            UInt32(MemoryLayout<pid_t>.size), &pidValue, &size, &object
        )
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }
}
