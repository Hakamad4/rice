import EventKit
import Foundation

/// Lembretes do app Lembretes (EKReminder), não eventos do Calendário. Só lê os de hoje e atrasados, e só conclui quando o usuário pede.
struct ReminderItem {
    let id: String
    let title: String
    let due: Date
    let hasTime: Bool
    let overdue: Bool
    let list: String
    let color: String?

    var json: [String: Any] {
        var out: [String: Any] = ["id": id, "title": title, "due": Output.iso(due), "hasTime": hasTime, "overdue": overdue, "list": list]
        if let color { out["color"] = color }
        return out
    }
}

enum RemindersFilter {
    /// Hoje (até 23:59:59) e atrasados; quem não tem vencimento fica de fora. Ordem: atrasados, depois por horário.
    static func today(_ items: [(id: String, title: String, due: DateComponents, list: String, color: String?)], now: Date, calendar: Calendar = .current) -> [ReminderItem] {
        let startOfToday = calendar.startOfDay(for: now)
        let endOfToday = calendar.date(byAdding: .day, value: 1, to: startOfToday)!
        return items.compactMap { item -> ReminderItem? in
            var comps = item.due
            comps.calendar = calendar
            guard let date = calendar.date(from: comps) else { return nil }
            guard date < endOfToday else { return nil }
            let hasTime = item.due.hour != nil
            return ReminderItem(id: item.id, title: item.title, due: date, hasTime: hasTime, overdue: date < startOfToday, list: item.list, color: item.color)
        }.sorted { ($0.overdue ? 0 : 1, $0.due) < ($1.overdue ? 0 : 1, $1.due) }
    }
}

final class RemindersWatcher {
    private let store = EKEventStore()

    static func accessStatus() -> String {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .fullAccess: return "granted"
        case .notDetermined: return "notDetermined"
        default: return "denied"
        }
    }

    func requestAccess() async -> Bool {
        (try? await store.requestFullAccessToReminders()) ?? false
    }

    /// Incompletos com vencimento até o fim de hoje (atrasados incluídos).
    func today(now: Date, completion: @escaping ([ReminderItem]) -> Void) {
        guard Self.accessStatus() == "granted" else { return completion([]) }
        let end = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now))!
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: end, calendars: nil)
        store.fetchReminders(matching: predicate) { reminders in
            let raw = (reminders ?? []).compactMap { r -> (id: String, title: String, due: DateComponents, list: String, color: String?)? in
                guard let due = r.dueDateComponents, !r.isCompleted else { return nil }
                return (r.calendarItemIdentifier, r.title ?? "", due, r.calendar?.title ?? "", r.calendar?.cgColor.flatMap(CalendarWatcher.hex))
            }
            completion(RemindersFilter.today(raw, now: now))
        }
    }

    /// Marca como concluído no app Lembretes. Só é chamado quando o usuário clica na caixinha.
    func complete(id: String) -> Bool {
        guard Self.accessStatus() == "granted", let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else { return false }
        reminder.isCompleted = true
        return (try? store.save(reminder, commit: true)) != nil
    }

    func observeChanges(_ onChange: @escaping () -> Void) {
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { _ in onChange() }
    }
}
