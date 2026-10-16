import AVFoundation
import Foundation

/// `--probe-inputs uid1,uid2 [--ms 1200]`: mede o nível e se há voz em cada entrada por ~1,2 s e imprime UMA linha JSON.
/// Modo à parte (processo curto, antes ou fora de uma gravação); não usa o `Recorder` nem a captura. Quem chama nunca passa Bluetooth inativo.
func runProbeInputs(uids: [String], milliseconds: Int) {
    let results = LockedList()
    let group = DispatchGroup()
    for uid in uids {
        group.enter()
        DispatchQueue.global().async {
            results.append(probe(uid: uid, milliseconds: milliseconds))
            group.leave()
        }
    }
    _ = group.wait(timeout: .now() + .milliseconds(milliseconds + 1500))
    let data = try! JSONSerialization.data(withJSONObject: ["levels": results.items], options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

private final class LockedList {
    private let lock = NSLock()
    private var storage: [[String: Any]] = []
    func append(_ item: [String: Any]) { lock.withLock { storage.append(item) } }
    var items: [[String: Any]] { lock.withLock { storage } }
}

private func probe(uid: String, milliseconds: Int) -> [String: Any] {
    guard let device = InputDevices.deviceID(forUID: uid) else { return ["id": uid, "error": "not-found"] }
    let engine = AVAudioEngine()
    let input = engine.inputNode
    guard let unit = input.audioUnit else { return ["id": uid, "error": "no-audio-unit"] }
    var id = device
    guard AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size)) == noErr else {
        return ["id": uid, "error": "set-device"]
    }
    let frames = LockedFrames()
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0 else { return ["id": uid, "error": "no-format"] }
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
        guard let channel = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        let window = max(1, Int(format.sampleRate * 0.02)) // quadros de 20 ms
        var start = 0
        while start + window <= n {
            var sum: Float = 0
            for i in start..<(start + window) { sum += channel[i] * channel[i] }
            frames.append(Double(sum / Float(window)))
            start += window
        }
    }
    do { try engine.start() } catch { return ["id": uid, "error": "start"] }
    Thread.sleep(forTimeInterval: Double(milliseconds) / 1000)
    input.removeTap(onBus: 0)
    engine.stop()
    let verdict = ProbeMath.verdict(frames.values)
    return ["id": uid, "rmsDb": verdict.rmsDb, "voice": verdict.voice]
}

private final class LockedFrames {
    private let lock = NSLock()
    private var storage: [Double] = []
    func append(_ v: Double) { lock.withLock { storage.append(v) } }
    var values: [Double] { lock.withLock { storage } }
}

/// VAD simples sobre a energia (média dos quadrados) de quadros de 20 ms: há voz se o nível passa de -50 dBFS e uma fração dos quadros
/// fica bem acima do ruído de fundo (o 20º percentil) — fala varia, ruído constante não.
enum ProbeMath {
    static func verdict(_ energies: [Double]) -> (rmsDb: Double, voice: Bool) {
        guard !energies.isEmpty else { return (-120, false) }
        let mean = energies.reduce(0, +) / Double(energies.count)
        let rmsDb = db(mean)
        let sorted = energies.sorted()
        let floorEnergy = sorted[Int(Double(sorted.count - 1) * 0.2)]
        let threshold = max(floorEnergy * 15.85, pow(10, -46.0 / 10)) // 12 dB acima do ruído e pelo menos -46 dBFS
        let loud = energies.filter { $0 > threshold }.count
        let ratio = Double(loud) / Double(energies.count)
        return (rmsDb, rmsDb > -50 && ratio >= 0.12 && ratio <= 0.9)
    }

    private static func db(_ energy: Double) -> Double { 10 * log10(max(energy, 1e-12)) }
}
