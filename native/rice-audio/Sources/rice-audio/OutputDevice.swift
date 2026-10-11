import CoreAudio
import Foundation

/// Saída de áudio padrão do Mac: usada para decidir se o AEC liga (alto-falante) ou não (fone).
enum OutputDevice {
    struct Info {
        let name: String
        let isHeadphones: Bool
        let reason: String
    }

    static func defaultOutputID() -> AudioObjectID? {
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    static func current() -> Info {
        guard let device = defaultOutputID() else { return Info(name: "?", isHeadphones: false, reason: "sem saída padrão") }
        let name = deviceName(device) ?? "?"
        let transport = uint32Property(device, kAudioDevicePropertyTransportType, scope: kAudioObjectPropertyScopeGlobal)
        if transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE {
            return Info(name: name, isHeadphones: true, reason: "saída Bluetooth (\(name))")
        }
        // Saída interna: a fonte de dados diz se é fone com fio ('hdpn') ou alto-falante ('ispk').
        if let source = uint32Property(device, kAudioDevicePropertyDataSource, scope: kAudioObjectPropertyScopeOutput),
           source == fourCC("hdpn") {
            return Info(name: name, isHeadphones: true, reason: "fone com fio (\(name))")
        }
        let lower = name.lowercased()
        if ["airpods", "headphone", "headset", "fone", "earpods", "buds"].contains(where: lower.contains) {
            return Info(name: name, isHeadphones: true, reason: "fone (\(name))")
        }
        return Info(name: name, isHeadphones: false, reason: "alto-falante (\(name))")
    }

    private static func fourCC(_ text: String) -> UInt32 {
        text.utf8.reduce(0) { ($0 << 8) | UInt32($1) }
    }

    private static func uint32Property(_ device: AudioObjectID, _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope) -> UInt32? {
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectHasProperty(device, &address) else { return nil }
        return AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr ? value : nil
    }

    private static func deviceName(_ device: AudioObjectID) -> String? {
        var name: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioObjectPropertyName,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &name) == noErr, let name else { return nil }
        return name.takeRetainedValue() as String
    }

    /// Chama `handler` (na fila dada) quando a saída padrão muda. Devolve um token para remover.
    static func observeDefaultOutput(queue: DispatchQueue, _ handler: @escaping () -> Void) -> AudioObjectPropertyListenerBlock {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let block: AudioObjectPropertyListenerBlock = { _, _ in handler() }
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, block)
        return block
    }

    static func stopObserving(queue: DispatchQueue, _ block: @escaping AudioObjectPropertyListenerBlock) {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, block)
    }
}
