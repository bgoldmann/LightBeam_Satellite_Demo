import UIKit

/// Keeps the display awake during optical receive (Scan TV / Decode Video).
enum KeepAwake {
    static func setEnabled(_ enabled: Bool) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
        }
    }
}
