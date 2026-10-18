import Foundation

let arguments = CommandLine.arguments

func value(after flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

func printJSON(_ object: Any) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

if arguments.contains("--match") {
    let app = AppMatcher.match(bundleId: value(after: "--match") ?? "")
    printJSON(["app": app as Any? ?? NSNull()])
    exit(0)
}

if arguments.contains("--print-mic-processes") {
    print(MicMonitor.bundleIdsUsingInput())
    exit(0)
}

if arguments.contains("--print-input") {
    // Entrada padrão atual: {"id":…,"name":…} (ou nulos se não houver). Só consulta o CoreAudio.
    printJSON(InputDevice.fields(InputDevice.current()).mapValues { $0 ?? NSNull() })
    exit(0)
}

if arguments.contains("--print-inputs") {
    // Entradas de áudio com transporte, padrão e "em uso por outro processo": {"inputs":[…]} (só consulta o CoreAudio).
    printJSON(["inputs": InputList.all().map(InputList.fields)])
    exit(0)
}

if let inputJSON = value(after: "--simulate-cover") {
    // {"window":N,"items":[{"number","layer","alpha","x","y","w","h"}…]} da frente para trás → {"covered":0…1,"onScreen":bool}
    let input = (try? JSONSerialization.jsonObject(with: Data(inputJSON.utf8))) as? [String: Any] ?? [:]
    let items = (input["items"] as? [[String: Any]] ?? []).map { o -> WindowCover.Item in
        func num(_ key: String) -> Double { (o[key] as? NSNumber)?.doubleValue ?? 0 }
        return WindowCover.Item(number: Int(num("number")), layer: Int(num("layer")), alpha: o["alpha"] == nil ? 1 : num("alpha"), rect: CGRect(x: num("x"), y: num("y"), width: num("w"), height: num("h")))
    }
    let result = WindowCover.evaluate(window: (input["window"] as? Int) ?? 0, items: items)
    printJSON(["covered": result.covered, "onScreen": result.onScreen])
    exit(0)
}

if let stepsJSON = value(after: "--simulate-mic") {
    let steps = (try? JSONSerialization.jsonObject(with: Data(stepsJSON.utf8))) as? [[String]] ?? []
    let watcher = MicWatcher()
    for step in steps { watcher.tick(bundleIds: step) }
    exit(0)
}

if let inputJSON = value(after: "--simulate-upcoming") {
    let parser = ISO8601DateFormatter()
    let input = (try? JSONSerialization.jsonObject(with: Data(inputJSON.utf8))) as? [String: Any] ?? [:]
    let now = parser.date(from: input["now"] as? String ?? "") ?? Date()
    let announced = Set(input["announced"] as? [String] ?? [])
    let events = (input["events"] as? [[String: String]] ?? []).compactMap { raw -> CalendarEvent? in
        guard let id = raw["id"], let start = parser.date(from: raw["start"] ?? ""), let end = parser.date(from: raw["end"] ?? "") else { return nil }
        return CalendarEvent(id: id, title: raw["title"] ?? "", start: start, end: end, url: nil)
    }
    printJSON(UpcomingFilter.due(events, now: now, announced: announced).map(\.id))
    exit(0)
}

if let inputJSON = value(after: "--simulate-reminders") {
    let parser = ISO8601DateFormatter()
    let input = (try? JSONSerialization.jsonObject(with: Data(inputJSON.utf8))) as? [String: Any] ?? [:]
    let now = parser.date(from: input["now"] as? String ?? "") ?? Date()
    let raw = (input["items"] as? [[String: Any]] ?? []).compactMap { o -> (id: String, title: String, due: DateComponents, list: String, color: String?)? in
        guard let id = o["id"] as? String else { return nil }
        var c = DateComponents()
        c.year = o["y"] as? Int; c.month = o["m"] as? Int; c.day = o["d"] as? Int
        c.hour = o["h"] as? Int; c.minute = o["min"] as? Int
        return (id, o["title"] as? String ?? "", c, "", nil)
    }
    printJSON(RemindersFilter.today(raw, now: now).map { ["id": $0.id, "overdue": $0.overdue, "hasTime": $0.hasTime] })
    exit(0)
}

let calendar = CalendarWatcher()
let reminders = RemindersWatcher()

if arguments.contains("--once") {
    let now = Date()
    printJSON([
        "event": "snapshot",
        "micInUse": MicMonitor.bundleIdsUsingInput(),
        "calendarAccess": CalendarWatcher.accessStatus(),
        "upcoming": calendar.events(from: now, to: now.addingTimeInterval(12 * 3600)).map { event in
            event.json.mapValues { $0 ?? NSNull() }
        },
    ])
    exit(0)
}

// Modo watch (usado pelo Rice).
let micWatcher = MicWatcher()
Output.emit("calendar-access", ["status": CalendarWatcher.accessStatus()])
Output.emit("reminders-access", ["status": RemindersWatcher.accessStatus()])

Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
    micWatcher.tick(bundleIds: MicMonitor.bundleIdsUsingInput())
}.fire()

Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
    calendar.tick(now: Date())
}.fire()

let inputWatcher = InputDeviceWatcher()
inputWatcher.announce()
inputWatcher.observeChanges()

calendar.observeChanges { Output.emit("calendar-changed", [:]) }
reminders.observeChanges { Output.emit("reminders-changed", [:]) }

let coverWatcher = CoverWatcher()
let inFlightCommands = DispatchGroup()

Thread {
    while let line = readLine() {
        guard let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any],
              let command = object["cmd"] as? String else {
            Output.emit("error", ["message": "invalid command line"])
            continue
        }
        switch command {
        case "current-event":
            inFlightCommands.enter()
            DispatchQueue.main.async {
                if let event = calendar.current(now: Date()) {
                    Output.emit("current-event", event.json)
                } else {
                    Output.emit("current-event", ["id": nil])
                }
                inFlightCommands.leave()
            }
        case "list-events":
            // lista do Início: inclui dia inteiro (alertas continuam sem eles)
            // o JS manda "…:00.000Z" (com milissegundos): o formatador padrão não lê isso e caía em "agora", o que escondia os eventos de dia inteiro de hoje
            let plain = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            func parse(_ text: String) -> Date? { plain.date(from: text) ?? fractional.date(from: text) }
            let from = parse(object["from"] as? String ?? "") ?? Calendar.current.startOfDay(for: Date())
            let to = parse(object["to"] as? String ?? "") ?? from.addingTimeInterval(8 * 86400)
            inFlightCommands.enter()
            DispatchQueue.main.async {
                Output.emit("events-list", ["events": calendar.events(from: from, to: to, includeAllDay: true).map(\.listJSON)])
                inFlightCommands.leave()
            }
        case "list-inputs":
            // Escolha do microfone ao gravar e menu do chip: só consulta o CoreAudio
            inFlightCommands.enter()
            DispatchQueue.main.async {
                Output.emit("inputs", ["inputs": InputList.all().map(InputList.fields)])
                inFlightCommands.leave()
            }
        case "cover-watch":
            // {"cmd":"cover-watch","window":N}: N = número CGWindow da janela principal (1 Hz, `window-cover`); 0 para
            let number = (object["window"] as? NSNumber)?.intValue ?? 0
            DispatchQueue.main.async { coverWatcher.watch(window: number) }
        case "current-input":
            inFlightCommands.enter()
            DispatchQueue.main.async {
                inputWatcher.announce(force: true)
                inFlightCommands.leave()
            }
        case "request-calendar-access":
            inFlightCommands.enter()
            Task {
                _ = await calendar.requestAccess()
                DispatchQueue.main.async {
                    Output.emit("calendar-access", ["status": CalendarWatcher.accessStatus()])
                    calendar.tick(now: Date())
                    inFlightCommands.leave()
                }
            }
        case "list-reminders":
            inFlightCommands.enter()
            DispatchQueue.main.async {
                reminders.today(now: Date()) { items in
                    Output.emit("reminders-list", ["reminders": items.map(\.json)])
                    inFlightCommands.leave()
                }
            }
        case "request-reminders-access":
            inFlightCommands.enter()
            Task {
                _ = await reminders.requestAccess()
                DispatchQueue.main.async {
                    Output.emit("reminders-access", ["status": RemindersWatcher.accessStatus()])
                    inFlightCommands.leave()
                }
            }
        case "complete-reminder":
            let id = object["id"] as? String ?? ""
            inFlightCommands.enter()
            DispatchQueue.main.async {
                Output.emit("reminder-completed", ["id": id, "ok": reminders.complete(id: id)])
                inFlightCommands.leave()
            }
        default:
            Output.emit("error", ["message": "unknown command: \(command)"])
        }
    }
    inFlightCommands.notify(queue: .main) { exit(0) }
}.start()

RunLoop.main.run()
