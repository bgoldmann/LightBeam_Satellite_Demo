import SwiftUI

@main
struct LightBeamApp: App {
    @AppStorage("preferredLanguageTag") private var preferredLanguageTag = "system"

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.locale, appLocale)
        }
    }

    private var appLocale: Locale {
        switch preferredLanguageTag {
        case "en": return Locale(identifier: "en")
        case "fa": return Locale(identifier: "fa")
        default: return .autoupdatingCurrent
        }
    }
}
