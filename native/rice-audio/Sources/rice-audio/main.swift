import Foundation

let arguments = CommandLine.arguments

func value(after flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

if arguments.contains("--selftest-tone") {
    runToneSelfTest()
    exit(0)
}

if arguments.contains("--selftest-aec") {
    runAecSelfTest()
    exit(0)
}

if arguments.contains("--selftest-gap") {
    runGapSelfTest()
    exit(0)
}

if arguments.contains("--list-inputs") {
    // {"inputs":[{"id","isDefault","name","state","transport"}]}: as entradas do CoreAudio (mesma forma do Windows, mais o transporte)
    let inputs = InputDevices.list().map { ["id": $0.uid, "isDefault": $0.isDefault, "name": $0.name, "state": "active", "transport": $0.transport] as [String: Any] }
    let data = try! JSONSerialization.data(withJSONObject: ["inputs": inputs], options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

if let list = value(after: "--probe-inputs") {
    runProbeInputs(uids: list.split(separator: ",").map(String.init), milliseconds: Int(value(after: "--ms") ?? "") ?? 1200)
    exit(0)
}

let echoCancellation = !arguments.contains("--no-aec")
/// Microfone escolhido (UID): `--mic-device` ou a variável RICE_MIC_DEVICE (como no Windows). Sem escolha, a entrada padrão do macOS.
let micDeviceUID: String? = {
    let chosen = value(after: "--mic-device") ?? ProcessInfo.processInfo.environment["RICE_MIC_DEVICE"]
    return chosen?.isEmpty == false ? chosen : nil
}()

let systemSource: Recorder.SystemSource
switch value(after: "--system-source") {
case "tap": systemSource = .tap
case "sck": systemSource = .sck
default: systemSource = .auto
}
let excludePIDs: [pid_t] = arguments.enumerated().compactMap { index, arg in
    guard arg == "--exclude-pid", index + 1 < arguments.count else { return nil }
    return pid_t(arguments[index + 1])
}

if let secondsText = value(after: "--seconds"), let seconds = Double(secondsText), let outDir = value(after: "--out-dir") {
    do {
        let recorder = Recorder(sink: try FileFrameSink(directory: outDir), echoCancellation: echoCancellation, systemSource: systemSource, excludePIDs: excludePIDs, micDeviceUID: micDeviceUID)
        Task {
            await recorder.start()
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            await recorder.stop()
            exit(0)
        }
    } catch {
        Events.emit("error", ["source": "cli", "message": error.localizedDescription])
        exit(1)
    }
    dispatchMain()
}

let stdoutSink = StdoutFrameSink()
let recorder = Recorder(sink: stdoutSink, echoCancellation: echoCancellation, systemSource: systemSource, excludePIDs: excludePIDs, micDeviceUID: micDeviceUID)

var shuttingDown = false
let shutdownLock = NSLock()

/// Para a gravação e sai. O watchdog garante a saída em 3 s mesmo se
/// SCStream.stopCapture travar.
func shutdown() {
    shutdownLock.lock()
    if shuttingDown {
        shutdownLock.unlock()
        return
    }
    shuttingDown = true
    shutdownLock.unlock()
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { exit(0) }
    Task {
        await recorder.stop()
        stdoutSink.drain()
        exit(0)
    }
}

func handle(line: String) async {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let command = object["cmd"] as? String else {
        Events.emit("error", ["source": "cli", "message": "invalid command line"])
        return
    }
    switch command {
    case "start": await recorder.start()
    case "mic-device": recorder.switchMic(to: (object["id"] as? String).flatMap { $0.isEmpty ? nil : $0 })
    case "stop": shutdown()
    default:
        Events.emit("error", ["source": "cli", "message": "unknown command: \(command)"])
    }
}

Thread {
    // Não espera a execução de cada comando: stop/EOF precisam ser vistos
    // mesmo enquanto um start está preso (ex.: pedido de permissão).
    while let line = readLine() {
        Task { await handle(line: line) }
    }
    // EOF: o processo pai fechou o stdin (ou morreu). Para e sai.
    shutdown()
}.start()

dispatchMain()
