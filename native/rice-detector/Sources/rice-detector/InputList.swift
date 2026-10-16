import CoreAudio
import Foundation

/// Lista as entradas de áudio do CoreAudio com o que a escolha do microfone precisa saber: transporte (builtin/usb/bluetooth/virtual…),
/// se é a padrão e se OUTRO processo está usando como entrada agora. Só consulta; este processo não abre nenhum dispositivo nem grava áudio.
enum InputList {
    struct Entry: Equatable {
        let id: String       // UID do CoreAudio (estável entre reinícios)
        let name: String
        let transport: String
        let isDefault: Bool
        let inUse: Bool
    }

    static func fields(_ entry: Entry) -> [String: Any] {
        ["id": entry.id, "inUse": entry.inUse, "isDefault": entry.isDefault, "name": entry.name, "transport": entry.transport]
    }

    private static func address(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    private static func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var a = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &a, 0, nil, &size, $0) }
        guard status == noErr, let text = value?.takeRetainedValue() else { return nil }
        return text as String
    }

    private static func uint32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
        var a = address(selector)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(object, &a, 0, nil, &size, &value) == noErr ? value : nil
    }

    private static func ids(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> [AudioObjectID] {
        var a = address(selector, scope: scope)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(object, &a, 0, nil, &size) == noErr, size > 0 else { return [] }
        var out = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(object, &a, 0, nil, &size, &out) == noErr else { return [] }
        return out
    }

    private static func hasInput(_ id: AudioObjectID) -> Bool {
        var a = address(kAudioDevicePropertyStreamConfiguration, scope: kAudioDevicePropertyScopeInput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size > 0 else { return false }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, raw) == noErr else { return false }
        return UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self)).contains { $0.mNumberChannels > 0 }
    }

    static func transport(_ type: UInt32?) -> String {
        switch type {
        case kAudioDeviceTransportTypeBuiltIn: return "builtin"
        case kAudioDeviceTransportTypeUSB: return "usb"
        case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
        case kAudioDeviceTransportTypeAggregate: return "aggregate"
        case kAudioDeviceTransportTypeVirtual: return "virtual"
        default: return "other"
        }
    }

    /// Dispositivos que algum processo está usando como ENTRADA agora (kAudioProcessPropertyIsRunningInput + kAudioProcessPropertyDevices, macOS 14.2+).
    /// Mais preciso que `IsRunningSomewhere`, que também vale para a saída do mesmo fone ou placa.
    private static func devicesInUseByProcesses() -> Set<AudioObjectID> {
        var used = Set<AudioObjectID>()
        for process in ids(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) where uint32(process, kAudioProcessPropertyIsRunningInput) == 1 {
            used.formUnion(ids(process, kAudioProcessPropertyDevices, scope: kAudioObjectPropertyScopeInput))
        }
        return used
    }

    static func all() -> [Entry] {
        let system = AudioObjectID(kAudioObjectSystemObject)
        let current = ids(system, kAudioHardwarePropertyDefaultInputDevice).first
        let used = devicesInUseByProcesses()
        return ids(system, kAudioHardwarePropertyDevices).compactMap { device in
            guard hasInput(device), let uid = string(device, kAudioDevicePropertyDeviceUID) else { return nil }
            return Entry(id: uid, name: string(device, kAudioObjectPropertyName) ?? uid, transport: transport(uint32(device, kAudioDevicePropertyTransportType)), isDefault: device == current, inUse: used.contains(device))
        }
    }
}
