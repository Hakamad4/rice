import Foundation
import IOKit.pwr_mgt

/// Impede o Mac de entrar em repouso por inatividade enquanto grava.
final class SleepGuard {
    private var assertionID: IOPMAssertionID = 0
    private var active = false

    func begin() {
        guard !active else { return }
        let status = IOPMAssertionCreateWithName(
            kIOPMAssertionTypePreventUserIdleSystemSleep as CFString,
            IOPMAssertionLevel(kIOPMAssertionLevelOn),
            "Rice está gravando uma reunião" as CFString,
            &assertionID
        )
        active = status == kIOReturnSuccess
        if !active { Events.emit("warning", ["source": "power", "message": "não foi possível impedir o repouso (\(status))"]) }
    }

    func end() {
        guard active else { return }
        IOPMAssertionRelease(assertionID)
        active = false
    }
}
