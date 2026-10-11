import EventKit
import Foundation

struct CalendarEvent {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let url: String?
    var allDay = false
    var calendar = ""
    var color: String? = nil
    var attendees = 0

    /// Alertas e convites de gravação só usam `id/title/start/end/url`; o resto serve à lista do Início.
    var json: [String: Any?] {
        ["id": id, "title": title, "start": Output.iso(start), "end": Output.iso(end), "url": url]
    }

    var listJSON: [String: Any] {
        var out: [String: Any] = ["id": id, "title": title, "start": Output.iso(start), "end": Output.iso(end), "allDay": allDay, "calendar": calendar, "attendees": attendees]
        if let url { out["url"] = url }
        if let color { out["color"] = color }
        return out
    }
}

enum UpcomingFilter {
    static let lookBehind: TimeInterval = 120
    static let lookAhead: TimeInterval = 60

    static func due(_ events: [CalendarEvent], now: Date, announced: Set<String>) -> [CalendarEvent] {
        events.filter { event in
            !announced.contains(event.id)
                && event.start >= now.addingTimeInterval(-lookBehind)
                && event.start <= now.addingTimeInterval(lookAhead)
        }
    }
}

final class CalendarWatcher {
    private let store = EKEventStore()
    private var announced = Set<String>()

    static func accessStatus() -> String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: return "granted"
        case .notDetermined: return "notDetermined"
        default: return "denied"
        }
    }

    func requestAccess() async -> Bool {
        (try? await store.requestFullAccessToEvents()) ?? false
    }

    /// `includeAllDay` só para a lista do Início; alertas e `current` seguem ignorando eventos de dia inteiro.
    func events(from: Date, to: Date, includeAllDay: Bool = false) -> [CalendarEvent] {
        guard Self.accessStatus() == "granted" else { return [] }
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
        return store.events(matching: predicate)
            .filter { includeAllDay || !$0.isAllDay }
            .map { event in
                CalendarEvent(
                    id: "\(event.calendarItemIdentifier)@\(Output.iso(event.startDate))",
                    title: event.title ?? "",
                    start: event.startDate,
                    end: event.endDate,
                    url: event.url?.absoluteString,
                    allDay: event.isAllDay,
                    calendar: event.calendar?.title ?? "",
                    color: event.calendar?.cgColor.flatMap(Self.hex),
                    attendees: event.attendees?.count ?? 0
                )
            }
            .sorted { $0.start < $1.start }
    }

    static func hex(_ color: CGColor) -> String? {
        guard let rgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil), let c = rgb.components, c.count >= 3 else { return nil }
        return String(format: "#%02X%02X%02X", Int(c[0] * 255), Int(c[1] * 255), Int(c[2] * 255))
    }

    /// Avisa quando o Calendário muda (evento criado, editado, conta sincronizada).
    func observeChanges(_ onChange: @escaping () -> Void) {
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { _ in onChange() }
    }

    func current(now: Date) -> CalendarEvent? {
        events(from: now.addingTimeInterval(-12 * 3600), to: now.addingTimeInterval(60))
            .filter { $0.start <= now.addingTimeInterval(60) && $0.end > now }
            .max { $0.start < $1.start }
    }

    func tick(now: Date) {
        let candidates = events(from: now.addingTimeInterval(-UpcomingFilter.lookBehind), to: now.addingTimeInterval(UpcomingFilter.lookAhead + 1))
        for event in UpcomingFilter.due(candidates, now: now, announced: announced) {
            announced.insert(event.id)
            Output.emit("upcoming-event", event.json)
        }
    }
}
