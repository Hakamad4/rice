import CoreAudio
import Foundation

/// Entrada padrão atual do sistema (a que o `rice-audio` usa: `AVAudioEngine.inputNode` sem dispositivo fixo segue o padrão).
/// Só consulta e observa o CoreAudio; este processo não grava áudio.
enum InputDevice {
    struct Info: Equatable {
        let id: String   // UID do dispositivo (estável entre reinícios)
        let name: String // nome amigável, ex.: "Microfone do MacBook Pro"
    }

    /// Campos do evento `default-input`. Separado para os testes, sem CoreAudio.
    static func fields(_ info: Info?) -> [String: Any?] {
        ["id": info?.id, "name": info?.name]
    }

    static func current() -> Info? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr,
              device != kAudioObjectUnknown,
              let uid = string(device, kAudioDevicePropertyDeviceUID) else { return nil }
        return Info(id: uid, name: string(device, kAudioObjectPropertyName) ?? uid)
    }

    private static func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain
        )
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
        guard status == noErr, let text = value?.takeRetainedValue() else { return nil }
        return text as String
    }
}

/// Emite `default-input` quando a entrada padrão muda (kAudioHardwarePropertyDefaultInputDevice) e sob demanda.
final class InputDeviceWatcher {
    private var last: InputDevice.Info?
    private var announcedOnce = false
    private let lock = NSLock()

    /// Emite o estado atual se for a primeira vez ou se mudou. `force` (comando `current-input`) emite sempre.
    func announce(force: Bool = false) {
        let now = InputDevice.current()
        lock.lock()
        let changed = !announcedOnce || now != last
        last = now
        announcedOnce = true
        lock.unlock()
        if changed || force { Output.emit("default-input", InputDevice.fields(now)) }
    }

    func observeChanges() {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, DispatchQueue.main) { [weak self] _, _ in
            self?.announce()
        }
    }
}
